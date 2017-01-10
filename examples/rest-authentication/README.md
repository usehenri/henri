
# Custom Express Server example

## How to use

Clone the [repo](https://github.com/simplehub/henri.git):

```
git clone https://github.com/simplehub/henri.git
```

Install it and run:

```bash
cd henri
npm install
cd examples/rest-authentication
npm install
npm run dev
```

## Example summary

Simple authentication with the REST connector.

Register will register first than log you in. The localStorage token will be populated and using POST, feathers will add a cookie for server-side authentication upon first request.

Login will log you in, set the localStorage and the cookie as stated above.