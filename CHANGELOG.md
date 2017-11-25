# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)


### Bug Fixes

* **cli:** remove the logs also, and recreate directory ([ca13738](https://github.com/usehenri/henri/commit/ca13738))
* **react:** no tests, no coverage, kthx ([fc76556](https://github.com/usehenri/henri/commit/fc76556))
* **router:** fix object assign to create new object and return a 501 error on controller-less routes ([3d5950f](https://github.com/usehenri/henri/commit/3d5950f))
* **router:** rename ressources to resources to match rails convention (en francais?) ([918a8c3](https://github.com/usehenri/henri/commit/918a8c3))
* **router:** return empty data to prevent exception ([bff9c36](https://github.com/usehenri/henri/commit/bff9c36))
* **router:** use _id instead of id.. consistent with mongodb models (why not?) ([6f1341b](https://github.com/usehenri/henri/commit/6f1341b))


### Features

* **cli:** add the generate crud cli ([f20f4d1](https://github.com/usehenri/henri/commit/f20f4d1))
* **cli:** adding generators for models and controllers ([64ea839](https://github.com/usehenri/henri/commit/64ea839))
* **cli:** adding show view to scaffold ([839d510](https://github.com/usehenri/henri/commit/839d510))
* **cli:** adding the about command ([aac06a2](https://github.com/usehenri/henri/commit/aac06a2))
* **cli:** adding the edit page to scaffold ([05393aa](https://github.com/usehenri/henri/commit/05393aa))
* **cli:** adding the scaffold command! generates a small MVC [WIP] ([23e4f6e](https://github.com/usehenri/henri/commit/23e4f6e))
* **react:** adding custom methods to form and fetch ([df011c6](https://github.com/usehenri/henri/commit/df011c6))
* **react:** adding withHenri HOC and forms components (WIP) ([9953147](https://github.com/usehenri/henri/commit/9953147))
* **react:** change fetchData to hydrate, and add a fetch method ([b35a5c6](https://github.com/usehenri/henri/commit/b35a5c6))
* **react:** forms component ([418dc2d](https://github.com/usehenri/henri/commit/418dc2d))
* **react:** withHenri HOC to help fetch data ([1273c8d](https://github.com/usehenri/henri/commit/1273c8d))
* **router:** add crud type routes (resources without views) ([344774a](https://github.com/usehenri/henri/commit/344774a))
* **router:** add the ressources for routes ([6db1c50](https://github.com/usehenri/henri/commit/6db1c50))
* **router:** adding scope to ressources ([99ff697](https://github.com/usehenri/henri/commit/99ff697))
* **router:** it is now possible to embed roles in routes definition ([007a109](https://github.com/usehenri/henri/commit/007a109))
* **router:** parsing routes and validating verbs ([1fe95f3](https://github.com/usehenri/henri/commit/1fe95f3))
* **server:** check the file changes with prettier and output errors (and don't reload) ([8fa958c](https://github.com/usehenri/henri/commit/8fa958c))
* **server:** clear the terminal on reload ([8f6e868](https://github.com/usehenri/henri/commit/8f6e868))
* **user:** add roles support (mongoose) ([4bb0f59](https://github.com/usehenri/henri/commit/4bb0f59))




<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)


### Bug Fixes

* **model:** pretty-print json file to eslintrc ([14fd689](https://github.com/usehenri/henri/commit/14fd689))
* **user:** sometimes, user can be empty ([8cab0b1](https://github.com/usehenri/henri/commit/8cab0b1))


### Features

* **henri:** adding ts definitions ([913916d](https://github.com/usehenri/henri/commit/913916d))
* **mongoose:** export types ([f30d244](https://github.com/usehenri/henri/commit/f30d244))
* **user:** inject user properly  into context ([2a3ef61](https://github.com/usehenri/henri/commit/2a3ef61))




<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)


### Bug Fixes

* **cli:** boilerplate package.json was old ([173c712](https://github.com/usehenri/henri/commit/173c712))
* **log:** better log output ([9b159b1](https://github.com/usehenri/henri/commit/9b159b1))
* **model:** remove logs ([79bad32](https://github.com/usehenri/henri/commit/79bad32))
* **router:** rearrange the res.format to match html also ([292f0c5](https://github.com/usehenri/henri/commit/292f0c5))
* **server:** race condition with passport js middlewares ([3c4237d](https://github.com/usehenri/henri/commit/3c4237d))
* **user:** do not show password or login info. letfover from first draft ([47ad7ff](https://github.com/usehenri/henri/commit/47ad7ff))


### Features

* **cli:** adding outdated notifier ([6c7beb1](https://github.com/usehenri/henri/commit/6c7beb1))
* **henri:** add a better error description for missing cli ([b1038ff](https://github.com/usehenri/henri/commit/b1038ff))
* **model:** add models to global namespace in eslint automatically ([6cf5846](https://github.com/usehenri/henri/commit/6cf5846))
* **router:** adding support for custom middlewares ([00f0401](https://github.com/usehenri/henri/commit/00f0401))
* **server:** it is now possible to add specific folder to ignore (hot reload) ([988ff1f](https://github.com/usehenri/henri/commit/988ff1f))
* **user:** add support for custom user model (defaults to 'user' ([5180d61](https://github.com/usehenri/henri/commit/5180d61))
* **user:** no longer redirect on login. you will receive a 200 or 401. ([c56736f](https://github.com/usehenri/henri/commit/c56736f))
