'use strict';
const { expect } = require('chai');
const path = require('path');
const inlineImports = require('../inline-imports');
const FixturifyProject = require('fixturify-project');
describe('inline-imports', function () {
  let basedir;

  beforeEach(function () {
    const project = new FixturifyProject('my-example', '0.0.1', project => {
      project.files['apple.graphql'] = `
fragment apple on User {
  name
}`;
      project.files['orange.graphql'] = `
fragment orange on User {
  name
}`;
      project.files['parent.graphql'] = `
#import './apple.graphql'

fragment parent on User {
  name
}`;

      // used in custom resolution
      project.files.vendor = {
        '__inlined-fragment': `
fragment CustomResolutionFragment on User {
  name
}`,
      };

      project.files['cycle-1.graphql'] = `
#import './cycle-1.graphql'
fragment cycle on User {
  name
}`;

      project.files['from-dependency.graphql'] = `
#import 'my-dependency/_dependency-fragment.graphql'
query {
  myQuery {
    ...FromDependency
  }
}`;

      project.files['circular-file-reference-1.graphql'] = `
#import './circular-file-reference-2.graphql'
fragment a on User {
  text {
    ...textFragment
  }
}
fragment b on User2 {
  text {
    ...textFragment
  }
}`;

      project.files['circular-file-reference-2.graphql'] = `
#import './circular-file-reference-1.graphql'
fragment userCollection on UserCollection {
  user1 {
    ...a
  }
  user2 {
    ...b
  }
}
fragment textFragment on TextModel {
  text
}`;

      project.addDependency('my-dependency', '0.0.1', dependency => {
        dependency.files['_dependency-fragment.graphql'] = `
fragment FromDependency on User {
  name
}`;
      });
    });
    project.writeSync();
    basedir = project.baseDir;
  });

  function assertProjectImports(options) {
    expect(inlineImports(``, options)).to.eql(``);
    expect(
      inlineImports(
        `
#import './apple.graphql'
`,
        options,
      ),
    ).to.eql(
      `

fragment apple on User {
  name
}
`,
    );

    expect(
      inlineImports(
        `
#import './apple.graphql'
#import './apple.graphql'
`,
        options,
      ),
    ).to.eql(
      `

fragment apple on User {
  name
}
`,
    );

    expect(
      inlineImports(
        `
#import './apple.graphql'
#import './orange.graphql'
`,
        options,
      ),
    ).to.eql(`

fragment apple on User {
  name
}

fragment orange on User {
  name
}
`);

    expect(
      inlineImports(
        `
#import './parent.graphql'
`,
        options,
      ),
    ).to.eql(`


fragment apple on User {
  name
}

fragment parent on User {
  name
}
`);

    expect(
      inlineImports(
        `
#import './cycle-1.graphql'
`,
        options,
      ),
    ).to.eql(`

fragment cycle on User {
  name
}
`);
  }

  it('handle circular file references correctly', function () {
    const options = { resolveOptions: { basedir } };
    assertProjectImports(options);
    expect(
      inlineImports(
        `
#import './circular-file-reference-2.graphql'
query A {
  userCollection {
    ...userCollection
  }
}`,
        options,
      ),
    ).to.eql(`


fragment a on User {
  text {
    ...textFragment
  }
}
fragment b on User2 {
  text {
    ...textFragment
  }
}
fragment userCollection on UserCollection {
  user1 {
    ...a
  }
  user2 {
    ...b
  }
}
fragment textFragment on TextModel {
  text
}
query A {
  userCollection {
    ...userCollection
  }
}`);
  });

  it('handles includes correctly', function () {
    let options = { resolveOptions: { basedir } };
    assertProjectImports(options);
    expect(
      inlineImports(
        `
#import "my-dependency/_dependency-fragment.graphql"
    `,
        options,
      ),
    ).to.eql(`

fragment FromDependency on User {
  name
}
    `);
  });

  it('supports custom resolution strategies', function () {
    let resolutions = [];

    function resolveImport(identifier, { basedir }) {
      resolutions.push([identifier, basedir]);

      if (identifier.length > 0 && identifier.charAt(0) === '.') {
        // relative
        return path.join(basedir, identifier);
      }

      if (identifier === '@CUSTOM') {
        return path.join(basedir, 'vendor', '__inlined-fragment');
      }

      throw new Error(`Unexpected resolveImport('${identifier}')`);
    }

    let options = {
      resolveImport,
      resolveOptions: {
        basedir,
      },
    };

    assertProjectImports(options);
    expect(resolutions).to.deep.equal([
      ['./apple.graphql', basedir],
      ['./apple.graphql', basedir],
      ['./apple.graphql', basedir],
      ['./apple.graphql', basedir],
      ['./orange.graphql', basedir],
      ['./parent.graphql', basedir],
      ['./apple.graphql', basedir],
      ['./cycle-1.graphql', basedir],
      ['./cycle-1.graphql', basedir],
    ]);

    expect(
      inlineImports(
        `
#import "@CUSTOM"
    `,
        options,
      ),
    ).to.eql(`

fragment CustomResolutionFragment on User {
  name
}
    `);
  });
});
