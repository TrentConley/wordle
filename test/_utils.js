export function makeReq({ method = 'GET', params = {}, query = {}, body = null } = {}) {
  return {
    method,
    params,
    query,
    body
  };
}

export function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    sent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.sent = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.sent = true;
      return this;
    },
    set(field, value) {
      this.headers[field.toLowerCase()] = value;
      return this;
    }
  };
  return res;
}

