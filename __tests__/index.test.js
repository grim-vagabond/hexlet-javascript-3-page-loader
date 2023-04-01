import os from 'os';
import path from 'path';
import nock from 'nock';
import * as fsp from 'node:fs/promises';
import pageLoader from '../src/pageLoader.js';

const getFixturePath = (...filepaths) => path.resolve(`__fixtures__/${path.join(...filepaths)}`);
const isExist = (filepath) => {
  const { dir, base } = path.parse(filepath);
  return fsp.readdir(dir).then((filenames) => filenames.includes(base));
};

const pagePath = 'ru-hexlet-io-courses.html';
const pageUrl = new URL('https://ru.hexlet.io/courses');
const contentDir = 'ru-hexlet-io-courses_files';

let expectedPage = '';
let tempDir = '';
let content = [
  {
    format: 'css',
    url: '/assets/application.css',
    filename: path.join(contentDir, 'ru-hexlet-io-assets-application.css'),
  },
  {
    format: 'png',
    url: '/assets/professions/nodejs.png',
    filename: path.join(contentDir, 'ru-hexlet-io-assets-professions-nodejs.png'),
  },
  {
    format: 'js',
    url: '/packs/js/runtime.js',
    filename: path.join(contentDir, 'ru-hexlet-io-packs-js-runtime.js'),
  },
  {
    format: 'html',
    url: '/courses',
    filename: path.join(contentDir, 'ru-hexlet-io-courses.html'),
  },
];

const formats = content.map(({ format }) => format);
const scope = nock(pageUrl.origin).persist();

nock.disableNetConnect();

beforeAll(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'page-loader-'));
  expectedPage = await fsp.readFile(getFixturePath('expected', pagePath), 'utf-8');

  const promises = content.map((file) => fsp.readFile(
    getFixturePath('expected', file.filename),
  ).then((data) => ({ ...file, data })));
  content = await Promise.all(promises);

  const page = await fsp.readFile(getFixturePath(pagePath), 'utf-8');
  scope.get(pageUrl.pathname).reply(200, page);
  content.forEach(({ url, data }) => scope.get(url).reply(200, data));
});

describe('page loader file system errors', () => {
  test('load page: no such file or directory', async () => {
    const invalidPath = getFixturePath('invalidPath');
    await expect(pageLoader(invalidPath, pageUrl.href)).rejects
      .toThrow(`ENOENT: no such file or directory, mkdir '${path.join(invalidPath, contentDir)}'`);
  });

  test('load page: permission denied', async () => {
    const rootDir = '/root';
    await expect(pageLoader(rootDir, pageUrl.href)).rejects
      .toThrow(`EACCES: permission denied, lstat '${path.join(rootDir, contentDir)}'`);
  });

  test('load page: not a directory', async () => {
    const filepath = getFixturePath(pagePath);
    await expect(pageLoader(filepath, pageUrl.href)).rejects
      .toThrow(`ENOTDIR: not a directory, lstat '${path.join(filepath, contentDir)}'`);
  });
});

describe('page loader network errors', () => {
  test('load page: invalid url', async () => {
    const invalidUrl = new URL('https://ru.null.null');
    const expectedError = `getaddrinfo ENOTFOUND ${invalidUrl}`;
    nock(invalidUrl).get('/').replyWithError(expectedError);
    await expect(pageLoader(tempDir, invalidUrl)).rejects.toThrow(expectedError);

    const isFileExist = await isExist(path.join(tempDir, pagePath));
    expect(isFileExist).toBeFalsy();
  });

  test.each([404, 500])('load page: response status code %s', async (code) => {
    scope.get(`/${code}`).reply(code, null);
    await expect(pageLoader(tempDir, new URL(`${pageUrl.origin}/${code}`)))
      .rejects.toThrow(`Request failed with status code ${code}`);
  });
});

describe('page loader', () => {
  test('load page', async () => {
    await pageLoader(tempDir, pageUrl.href);

    const isPageExist = await isExist(path.join(tempDir, pagePath));
    expect(isPageExist).toBeTruthy();

    const actualPage = await fsp.readFile(path.join(tempDir, pagePath), 'utf-8');
    expect(actualPage).toEqual(expectedPage);
  });

  test.each(formats)('load .%s file', async (format) => {
    const { filename, data } = content.find((file) => file.format === format);

    const isFileExist = await isExist(path.join(tempDir, filename));
    expect(isFileExist).toBeTruthy();

    const actualFile = await fsp.readFile(path.join(tempDir, filename));
    expect(actualFile).toEqual(data);
  });
});
