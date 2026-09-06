/**
 * Uploads, the way a controller writes them: `req.permit()` for the fields,
 * `req.permitFiles()` for the files, `store()` for what reaches a model.
 *
 * The demo has no attachment model, so the record `store()` returns is kept
 * in memory here; in an application it is a `json` column.
 */
const kept = new Map();

module.exports = {
  /**
   * Accepts one file in the `scan` field and nothing else
   *
   * @param {object} req the request
   * @param {object} res the response
   * @returns {Promise<object>} the response
   */
  async create(req, res) {
    const data = req.permit('title');
    const { scan } = req.permitFiles('scan');

    if (!scan || scan.length === 0) {
      return res.boom.badRequest('no file in the "scan" field');
    }

    const record = await scan[0].store({ prefix: 'demo' });

    kept.set(record.checksum, record);

    return res.status(201).json({
      declaredType: scan[0].declaredType,
      file: record,
      mistyped: scan[0].mistyped,
      title: data.title || null,
    });
  },

  /**
   * Hands a stored file back, as a download
   *
   * @param {object} req the request
   * @param {object} res the response
   * @returns {Promise<object>} the response
   */
  async show(req, res) {
    const record = kept.get(req.params.id);

    if (!record) {
      return res.boom.notFound('no such upload');
    }

    return henri.uploads.send(res, record);
  },
};
