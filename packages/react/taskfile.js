export async function compile(task) {
  await task.parallel(['lib']);
}

export async function lib(task, opts) {
  await task
    .source(opts.src || 'src/**/*.js')
    .babel()
    .target('dist/lib');
}

export async function release(task, opts) {
  await task.clear('dist').start('lib');
}

export default async function(task) {
  await task.start('lib');
  await task.watch('src/**/*.js', 'lib');
}
