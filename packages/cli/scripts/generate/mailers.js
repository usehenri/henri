/**
 * Templates of `henri generate mailer`: the mailer itself, one view per
 * action and the layout every mail view is wrapped in.
 */

/**
 * The mailer file (app/mailers/<name>.js)
 *
 * @param {object} mailer { name, actions }
 * @returns {string} the code
 */
const mailer = ({ name, actions }) => `// Mailers describe a message and let henri render and deliver it: an action
// returns the recipients, the subject and the \`data\` its view needs, and
// app/views/mailers/${name}/<action>.hbs renders it. The plain text part is
// derived from it unless a <action>.text.hbs sits next to the view.
//
//   await henri.mailers.${name}.${actions[0]}(user).deliver();      // now
//   await henri.mailers.${name}.${actions[0]}(user).deliverLater(); // out of band
//
// Preview them while the server runs: http://localhost:3000/_mailers
module.exports = {
  defaults: {
    from: 'Example <no-reply@example.com>',
  },
${actions
  .map(
    (action) => `
  ${action}: (user) => ({
    data: { user },
    subject: '${action.charAt(0).toUpperCase()}${action.slice(1)}',
    to: user.email,
  }),`
  )
  .join('')}

  // The sample data of the previews: the arguments of the action
  previews: {
${actions
  .map(
    (action) =>
      `    ${action}: () => [{ email: 'ada@example.com', name: 'Ada' }],`
  )
  .join('\n')}
  },
};
`;

/**
 * One mail view (app/views/mailers/<name>/<action>.hbs)
 *
 * @param {object} view { name, action }
 * @returns {string} the template
 */
const view = ({ name, action }) => `<h1 style="margin:0 0 16px;font-size:20px;">Hello {{user.name}}</h1>

<p style="margin:0 0 16px;line-height:1.5;">
  This is <b>{{@mailer}}#{{@action}}</b>, rendered from
  <code>app/views/mailers/${name}/${action}.hbs</code> inside
  <code>app/views/mailers/layouts/mailer.hbs</code>.
</p>

<p style="margin:0;">
  <a href="{{@localUrl}}" style="color:#2563eb;">Open the application</a>
</p>
`;

/**
 * The layout of the mail views (app/views/mailers/layouts/mailer.hbs)
 * A table wrapper and inline styles: the two things every mail client
 * agrees on. `{{{body}}}` is where the view goes.
 *
 * @returns {string} the template
 */
const layout = () => `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px;">
                {{{body}}}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#71717a;">
            Sent by {{@mailer}} &mdash; <a href="{{@localUrl}}" style="color:#71717a;">unsubscribe</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

/**
 * The plain text layout, written next to the rich one so an authored
 * <action>.text.hbs is wrapped the same way
 *
 * @returns {string} the template
 */
const textLayout = () => `{{{body}}}

--
Sent by {{@mailer}} -- {{@localUrl}}
`;

module.exports = { layout, mailer, textLayout, view };
