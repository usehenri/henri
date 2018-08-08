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

export async function yalc(task, opts) {
  await task.source('.').shell('yalc push');
}

export async function local(task, opts) {
  await task.start('lib');
  await task.start('yalc');
  await task.watch('src/**/*.js', ['lib', 'yalc']);
}

export default async function(task) {
  await task.start('lib');
  await task.watch('src/**/*.js', 'lib');
}
