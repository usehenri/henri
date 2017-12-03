const header = () => `const { log } = henri; module.exports = {`;

const index = (lower, doc) => {
  return `
  index: async (req, res) => {
    res.render('/_scaffold/${lower}/index', { 
      ${lower}: await ${doc}.find() 
    }); 
  },`;
};

const newC = (lower, doc) => {
  return `new: async (req, res) => { res.render('/_scaffold/${lower}/new') },`;
};

const create = (lower, doc) => {
  return `create: async (req, res) => {
    const data = req.body; const doc = new ${doc}(data);
    const errors = await doc.validate()

    if (errors) {
      return res.status(400).send({msg: 'failed', error: errors.message});
    }
    await doc.save(); return res.send({ msg: 'success'}); },`;
};

const show = (lower, doc) => {
  return `show: async (req, res) => {
  if (!req.params.id) {
    return res.render('/_scaffold/${lower}/show')
  }
  return res.render('/_scaffold/${lower}/show', {
    ${lower}: await ${doc}.find({ _id: req.params.id }),
  })
},`;
};

const edit = (lower, doc) => {
  return `edit: async (req, res) => {
    if (!req.params.id) {
      return res.render('/_scaffold/${lower}/edit')
    }
    return res.render('/_scaffold/${lower}/edit', {
      ${lower}: await ${doc}.findOne({ _id: req.params.id }),
    })
  },`;
};

const update = (lower, doc) => {
  return `update: async (req, res) => {
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
};

const destroy = (lower, doc) => {
  return `destroy: async (req, res) => {
    if (!req.params.id) {
      return res.status(400).send({msg: 'invalid id'})
    }
    ${doc}.remove({ _id: req.params.id }, (err) => {
      if (err) {
        return res.status(400).send({msg: 'failed', error: err.message});
      }
      return res.send({ msg: 'success'});
    })},
  }`;
};

module.exports = { index, header, newC, create, show, edit, update, destroy };
