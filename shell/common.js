const { existsSync, mkdirSync, writeFileSync } = require('fs')

const prettify = data => JSON.stringify(data, undefined, 2) + '\n';

const ensureDir = (dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir)
  }
};

const saveFile = (path, data) => {
  writeFileSync(path, prettify(data), 'utf-8');
};

exports.ensureDir = ensureDir;

exports.saveFile = saveFile;
