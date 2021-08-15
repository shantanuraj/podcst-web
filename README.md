# [podcst-web](https://podcst.app)

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

Podcst Web is a modern PWA to listen to podcasts.

The aim of this project is to provide an excellent podcast listening experience,
on all types of devices (desktop, tablets, mobile).

Another major focus is on accessibility, the app is and should be accessible to the visually impaired, and allow 100% keyboard navigation.

> **Note:** This project only aims to support ever-green browsers.

## Architecture

This project uses the [gitflow](https://github.com/nvie/gitflow) branching model.
See the [development](#development) section below for additional details.

- [main](https://github.com/shantanuraj/podcst-web/tree/main) is the production branch
- [develop](https://github.com/shantanuraj/podcst-web/tree/develop) is the active branch where commits are made

### Prerequisites

* [Node](https://nodejs.org/)   - node version 8+ for using latest ES2016+ features
* [yarn](https://yarnpkg.com/)  - package manager

### Getting the Source Code

Once the prerequisites are installed on your system, you can clone this repository with `git` and install the code dependencies using `yarn`.

```bash
git clone https://github.com/shantanuraj/podcst-web
yarn
```

## Development

The following steps are for building and installing from the source code. First compile the code to the `build` folder in the project directory.

```bash
# dev: compiles to unoptimised dev friendly build
yarn dev

# build: compiles to optimised / minified production ready build
yarn build
```

or to compile in watch mode (automatically compile on file change)

```bash
yarn dev
```

Once the url reported by Next.js

## Building

When you first clone this repository, you'll need to initialize gitflow by running: `git flow init -d` in the project root folder.

Now that your local environment is all setup, you can use the following procedure to contribute to this project.

  1. Run `git flow feature start <feature-name>`
  1. Implement your feature and commit the changes.
  1. Run `git flow feature finish <feature-name>`

Use the following process to cut a new release.

  1. run `git flow release start <semver>`
  1. bump the `package.json` version.
  1. commit the changes.
  1. run `git flow release finish <semver>`
  1. run `git push --follow-tags`

You'll find a great [tutorial on gitflow here](http://jeffkreeftmeijer.com/2010/why-arent-you-using-git-flow/) if you want to learn more about the details of how it works.

## Running Unit Tests

None yet but when they (hopefully exist)

```shell
yarn test
```

## Deployment

Deployment is automated and managed using the [vercel cli](https://github.com/vercel/vercel).

```shell
# To deploy production builds
now --target production

# To deploy without aliasing
now
```

On every merge to `main` the production deployment is automatically updated.

## Built With

* [TypeScript](https://www.typescriptlang.org/) - ***Much Nicer JavaScript***
* [Howler](https://howlerjs.com/) - Manage play audio
* [SWR](https://swr.vercel.app/) - API data and caching
* [Next.js](https://nextjs.org/docs) - React with sane defaults

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for process details on
collaborating on this project.

## Versioning

We use [SemVer](http://semver.org/) for versioning. For available versions of this softare, see the ([releases on this repository](https://github.com/shantanuraj/podcst-web/releases)).

## Authors

See the list of [contributors][Contributor List] who participated in this project.

[Contributor List]:https://github.com/shantanuraj/podcst-web/contributors

## License

This project is licensed under the MIT License - see the
[LICENSE](LICENSE.md) file for details

## Acknowledgments

* [README template](https://gist.github.com/PurpleBooth/109311bb0361f32d87a2)
