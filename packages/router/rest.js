const codes = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',

  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  208: 'Already Reported',
  226: 'IM Used',

  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',

  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Requested Range Not Satisfiable',
  417: 'Expectation Failed',
  418: 'I am a teapot (RFC 2324)',
  420: 'Enhance Your Calm',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  444: 'No Response',
  451: 'Unavailable For Legal Reasons',
  499: 'Client Closed Request',

  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',
  507: 'Insufficient Storage',
  508: 'Loop Detected',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',
  511: 'Network Authentication Required',
  598: 'Network read timeout error',
  599: 'Network connect timeout error',
};

const respond = (code, res, data = null, msg = null) => {
  if (typeof codes[code] === 'undefined') {
    return respond(500, res, data, msg);
  }
  const response = {
    errors: [],
    data: [data],
  };
  code > 200 &&
    response.error.push({ status: code, title: codes[code], detail: msg });
  return res.status(code).send(response);
};

henri.rest = {
  200: (...params) => respond(200, ...params),
  ok: (...params) => respond(200, ...params),
  201: (...params) => respond(201, ...params),
  created: (...params) => respond(201, ...params),
  500: (...params) => respond(500, ...params),
  error: (...params) => respond(500, ...params),
  403: (...params) => respond(403, ...params),
  forbidden: (...params) => respond(403, ...params),
  code: (...params) => respond(...params),
};
