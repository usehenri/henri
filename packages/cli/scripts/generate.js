const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const prettier = require('prettier');

const { cwd, version } = require('./utils');

const main = args => {
  const cmd = args._.shift();
  switch (cmd) {
    case 'model':
      model(args._);
      break;
    case 'controller':
      controller(args._);
      break;
    case 'scaffold':
      scaffold(args._);
      break;
    case 'crud':
      buildCrud(args._);
      break;
    default:
      help();
  }
};

const model = ([file, ...args]) => {
  let code = `module.exports = `;
  const base = {
    schema: {},
    options: {
      timestamps: true,
    },
  };
  if (args.length > 0) {
    args.map(v => {
      const parts = v.split(':');
      base.schema[parts[0]] = { type: parts[1] || 'string' };
    });
  }
  code += util.inspect(base, { depth: 6 });
  output('model', 'models', file, code);
};

const controller = ([file, ...args], inner) => {
  let code = 'const { log } = henri; module.exports = {';

  if (args.length > 0) {
    args.map(v => {
      const fback = `res.status(501).send('controller ${file}#${v} not ready')`;
      code += `${v}: async (req,res) => { ${inner || fback} },`;
    });
  }
  code += '};';

  output('controller', 'controllers', file, code);
};

const scaffold = ([file, ...args]) => {
  model([capitalize(file), ...args]);
  resources(file);
  routes(`resources ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_scaffold',
  });
  views(file, args);
};

const buildCrud = ([file, ...args]) => {
  model([capitalize(file), ...args]);
  crud(file);
  routes(`crud ${file.toLowerCase()}`, {
    controller: file.toLowerCase(),
    scope: '_crud',
  });
};

const resources = file => {
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  let code = `const { log } = henri; module.exports = {`;

  code += `index: async (req, res) => {
    res.render('/_scaffold/${lower}/index', {
      ${lower}: await ${doc}.find(),
    });
  },`;

  code += `new: async (req, res) => {
    res.render('/_scaffold/${lower}/new')
  },`;

  code += `create: async (req, res) => {
    const data = req.body;
    const doc = new ${doc}(data);
    const errors = await doc.validate()

    if (errors) {
      return res.status(400).send({msg: 'failed', error: errors.message});
    }
    await doc.save();
    return res.send({ msg: 'success'});
  },`;

  code += `show: async (req, res) => {
    if (!req.params.id) {
      return res.render('/_scaffold/${lower}/show')
    }
    return res.render('/_scaffold/${lower}/show', {
      ${lower}: await ${doc}.find({ _id: req.params.id }),
    })
  },`;

  code += `edit: async (req, res) => {
    if (!req.params.id) {
      return res.render('/_scaffold/${lower}/edit')
    }
    return res.render('/_scaffold/${lower}/edit', {
      ${lower}: await ${doc}.findOne({ _id: req.params.id }),
    })
  },`;

  code += `update: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({msg: 'invalid id'})
    }
    ${doc}.update({ _id: req.params.id }, { $set: req.body }, (err) => {
      if (err) {
        return res.status(400).send({msg: 'failed', error: err.message});
      }
      return res.send({ msg: 'success'});
    })
  },`;

  code += `destroy: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({msg: 'invalid id'})
    }
    ${doc}.remove({ _id: req.params.id }, (err) => {
      if (err) {
        return res.status(400).send({msg: 'failed', error: err.message});
      }
      return res.send({ msg: 'success'});
    })
  },
}`;
  output('controller', 'controllers', file, code);
};

const crud = file => {
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  let code = `const { log } = henri; module.exports = {`;

  code += `index: async (req, res) => {
    res.render('/_scaffold/${lower}/index', {
      ${lower}: await ${doc}.find(),
    });
  },`;

  code += `create: async (req, res) => {
    const data = req.body;
    const doc = new ${doc}(data);
    const errors = await doc.validate()

    if (errors) {
      return res.status(400).send({msg: 'failed', error: errors.message});
    }
    await doc.save();
    return res.send({ msg: 'success'});
  },`;

  code += `update: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({msg: 'invalid id'})
    }
    ${doc}.update({ _id: req.params.id }, { $set: req.body }, (err) => {
      if (err) {
        return res.status(400).send({msg: 'failed', error: err.message});
      }
      return res.send({ msg: 'success'});
    })
  },`;

  code += `destroy: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({msg: 'invalid id'})
    }
    ${doc}.remove({ _id: req.params.id }, (err) => {
      if (err) {
        return res.status(400).send({msg: 'failed', error: err.message});
      }
      return res.send({ msg: 'success'});
    })
  },
}`;
  output('controller', 'controllers', file, code);
};

const views = (file, args) => {
  const doc = capitalize(file);
  const lower = file.toLowerCase();
  let code = `
  import React from 'react';
  import withHenri from '@usehenri/react/withHenri';
  
  const Index = ({ data: { ${lower} = [] }, fetch, hydrate }) => (
    <div>
      <h2>Listing ${doc}</h2>
      <hr />
      <table>
      <tbody>
        <tr>
  `;
  if (args.length > 0) {
    args.map(v => {
      const parts = v.split(':');
      const name = parts[0];
      code += `<td>${capitalize(name)}</td>`;
    });
  }

  code += `</tr>
        {${lower}.length === 0 && '<tr>Nothing to show</tr>'}
        {${lower}.length > 0 && ${lower}.map(v => {
          // Not easy to do template literals within another one... concat!
          const show = "/_scaffold/${lower}/" + v._id;
          const edit = "/_scaffold/${lower}/" + v._id + "/edit";
          return (
            <tr key={v._id}>`;
  if (args.length > 0) {
    args.map(v => {
      const parts = v.split(':');
      const name = parts[0];
      code += `<td>{v.${name}}</td>`;
    });
  }
  code += `
  <td><a href={show}>Show</a></td>
  <td><a href={edit}>Edit</a></td>
  <td><a href="#" onClick={(e) => {
    fetch("/_scaffold/${lower}/" + v._id, 'delete'); hydrate()
  }}>Destroy</a></td>
  </tr>
)})}
      </tbody>
      </table>
      <a href="/_scaffold/${lower}/new">New ${doc}</a>
    </div>
  );
    
  export default withHenri(Index);
  `;
  output('view', `views/pages/_scaffold/${lower}`, 'index', code);

  code = `
  import React from 'react';
  import { Button, Form, Input } from '@usehenri/react/forms';
  
  const ${
  doc
}Form = ({route, data = {}, action, button = 'Create', method}) => (
    <Form action={route} data={data} method={method}>
  `;
  if (args.length > 0) {
    args.map(v => {
      const parts = v.split(':');
      const name = parts[0];
      code += `  <Input
      name="${name}"
      placeholder="${name}"
      required
      validation={{
        isLength: { min: 1 },
      }}
      errorMsg={{
        isLength: 'Minimum 1 char',
      }}
    />`;
    });
  }
  code += `
    <Button>{button} ${doc}</Button>
  </Form>);

  export default ${doc}Form;
  `;
  output('view', `views/pages/_scaffold/${lower}`, '_form', code);

  code = `
  import React from 'react';
  import withHenri from '@usehenri/react/withHenri';
  import CreateForm from './_form'
  
  const New = () => (
    <div>
      <h2>New ${doc}</h2>
      <hr />
      <CreateForm route="/_scaffold/${lower}" button="Create" />
  </div>);

  export default withHenri(New);
  `;
  output('view', `views/pages/_scaffold/${lower}`, 'new', code);

  code = `
  import React from 'react';
  import withHenri from '@usehenri/react/withHenri';
  import CreateForm from './_form'
  
  const Edit = ({ data: { ${lower} = [] }}) => (
    <div>
      <h2>Edit ${doc}</h2>
      <hr />
      <CreateForm 
      route={getPath(${lower}._id)}
      button="Update" data={${lower}} method='patch'/>
  </div>);

  const getPath = (id) => "/_scaffold/${lower}/" + id

  export default withHenri(Edit);
  `;
  output('view', `views/pages/_scaffold/${lower}`, 'edit', code);

  code = `
  import React from 'react';
  import withHenri from '@usehenri/react/withHenri';
  
  const Show = ({ data: { ${lower} = [] }}) => (
    <div>
      <h2>Show {${lower}[0]._id.toString()}</h2>
      <hr />`;

  if (args.length > 0) {
    args.map(v => {
      const parts = v.split(':');
      const name = parts[0];
      code += `<div>${name}: {${lower}[0].${name}}</div>`;
    });
  }
  code += `</div>);

  export default withHenri(Show);
  `;
  output('view', `views/pages/_scaffold/${lower}`, 'show', code);
};

const routes = (key, opts) => {
  let code = `module.exports = `;
  const location = path.join(cwd, 'app', 'routes.js');
  const actual = require(location);
  actual[key] = opts;
  code += util.inspect(actual);
  fs.outputFileSync(
    location,
    prettier.format(code, {
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
  console.log(`> added route "${key}" @ ${location}`);
};

const output = (type, dir, file, code) => {
  const location = path.join(cwd, 'app', dir, `${file}.js`);
  fs.outputFileSync(
    path.join(cwd, 'app', dir, `${file}.js`),
    prettier.format(code, {
      singleQuote: true,
      trailingComma: 'es5',
    })
  );
  console.log(`> created ${type} "${file}" @ ${location}`);
};

const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);

const help = args => {
  console.log(
    `
    henri (${version})

    Usage
      $ henri generate <command> <target> [options]

    Available commands
      model, controller, scaffold

    Examples

      $ henri generate model User name:string birthday:date
        --> Creates a model with these attributes

      $ henri generate controller locations index show gps
        --> Creates a controller and routes to those actions
      
      $ henri g scaffold HighScore game:string score:integer
        --> Create a model, a controller with resources actions
            and the matching resources routes
  `
  );
  process.exit(0);
};

module.exports = main;
