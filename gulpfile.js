const fs = require('fs');
const gulp = require('gulp');
const babel = require('gulp-babel');

const babelOptions = JSON.parse(fs.readFileSync('.babelrc', 'utf-8'));

gulp.task('compile-client', () => {
  return gulp.src('src/client/*.js')
  .pipe(babel(babelOptions))
  .pipe(gulp.dest('dist/client'));
});

gulp.task('default', [
  'compile-client'
]);
