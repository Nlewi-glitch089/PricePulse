// An error the API sends back as { "error": message } with this HTTP status.
// `fields` (optional) maps form field names to messages, so the browser can
// show each problem next to the right input.
class HttpError extends Error {
  constructor(status, message, { fields, code, details } = {}) {
    super(message);
    this.status = status;
    if (fields) this.fields = fields;
    if (code) this.code = code;
    if (details) this.details = details;
  }
}

const notFound = (what = 'Item') => new HttpError(404, `${what} not found.`);

module.exports = { HttpError, notFound };
