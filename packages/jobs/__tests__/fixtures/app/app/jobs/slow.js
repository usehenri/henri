// Runs longer than its timeout, and watches the signal so it stops instead
// of leaving a timer behind
module.exports = {
  maxAttempts: 1,
  timeout: 40,

  perform: (args, context) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5000);

      context.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      });
    }),
};
