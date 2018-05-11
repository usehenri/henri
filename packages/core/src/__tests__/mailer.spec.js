const BaseModule = require('../base/module');
const Henri = require('../henri');
const Mailer = require('../1.mailer');

const fetch = require('isomorphic-fetch');

describe('mailer', () => {
  beforeAll(async () => {
    this.henri = new Henri({ runlevel: 1 });
    this.henri.forceMail = true;
    await this.henri.init();
  });

  afterAll(async () => {
    await this.henri.stop();
  });

  test('should be defined', () => {
    expect(this.henri.mail).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.mail).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const mailer = new Mailer();

    expect(mailer).toMatchSnapshot();
  });

  test('should populate testAccount', () => {
    expect(this.henri.mail.testAccount).toBeTruthy();
  });

  test('should not send malformed emails', async () => {
    await expect(this.henri.mail.send()).rejects.toBeDefined();
  });

  test('should send mails', async () => {
    const info = await this.henri.mail.send({
      from: 'robot@usehenri.io',
      subject: 'Hey there',
      text: 'Whats up?',
      to: 'felix@usehenri.io',
    });
    const url = this.henri.mail.nodemailer.getTestMessageUrl(info);

    expect(info).toBeTruthy();
    await expect(fetch(url).then(res => res.status)).resolves.toEqual(200);
  });

  test('should not send if transporter is not defined', async () => {
    delete this.henri.mail.transporter;

    expect(this.henri.mail.transporter).toBeUndefined();

    await expect(this.henri.mail.send()).rejects.toBeDefined();
  });

  test('should throw if no config and not testing', () => {
    this.henri.isTest = false;
    delete this.henri.mail.transporter;
    this.henri.mail.init();
    expect(this.henri.mail.transporter).toBeUndefined();
    this.henri.isTest = true;
  });
});
