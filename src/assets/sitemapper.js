/**
 * Sitemap Parser
 *
 * Copyright (c) 2020 Sean Thomas Burke
 * Licensed under the MIT license.
 * @author Sean Burke <@seantomburke>
 */

import xmlParse from 'xml2js-es6-promise';
import axios from 'axios';

const CancelToken = axios.CancelToken;
const source = CancelToken.source();

/**
 * @typedef {Object} Sitemapper
 */
export default class Sitemapper {
  /**
   * Construct the Sitemapper class
   *
   * @params {Object} options to set
   * @params {string} [options.url] - the Sitemap url (e.g http://wp.seantburke.com/sitemap.xml)
   * @params {Timeout} [options.timeout] - @see {timeout}
   *
   * @example let sitemap = new Sitemapper({
   *   url: 'http://wp.seantburke.com/sitemap.xml',
   *   timeout: 15000
   *  });
   */
  constructor(options = {}) {
    this.debug = options.debug;
    this.progress = options.progress;
    this.timeout = options.timeout || 15000
    this.timeoutTable = [];
    this.url = options.url;
    this.settings = { 
      timeout: this.timeout,
      url: this.url,
      ...options,
      headers: {
        ...options.headers,
      },
     };
  }

  /**
   * Gets the sites from a sitemap.xml with a given URL
   *
   * @public
   * @param {string} [url] - the Sitemaps url (e.g http://wp.seantburke.com/sitemap.xml)
   * @returns {Promise<SitesData>}
   * @example sitemapper.fetch('example.xml')
   *  .then((sites) => console.log(sites));
   */
  fetch(url = this.url) {
    this.url = url;
    if (this.debug || this.progress) console.log('Fetching urls for ', url); // eslint-disable-line no-console
    return new Promise(resolve => this.crawl(url).then(sites => resolve({ url, sites })));
  }

  /**
   * Get the timeout
   *
   * @example console.log(sitemapper.timeout);
   * @returns {Timeout}
   */
  static get timeout() {
    return this.timeout;
  }

  /**
   * Set the timeout
   *
   * @public
   * @param {Timeout} duration
   * @example sitemapper.timeout = 15000; // 15 seconds
   */
  static set timeout(duration) {
    this.timeout = duration;
  }

  /**
   *
   * @param {string} url - url for making requests. Should be a link to a sitemaps.xml
   * @example sitemapper.url = 'http://wp.seantburke.com/sitemap.xml'
   */
  static set url(url) {
    this.url = url;
  }

  /**
   * Get the url to parse
   * @returns {string}
   * @example console.log(sitemapper.url)
   */
  static get url() {
    return this.url;
  }

  /**
   * Requests the URL and uses xmlParse to parse through and find the data
   *
   * @private
   * @param {string} [url] - the Sitemaps url (e.g http://wp.seantburke.com/sitemap.xml)
   * @returns {Promise<ParseData>}
   */
  parse(url = this.url) {
    if (this.debug) console.log('\n[Debug]: Crawling ', url); // eslint-disable-line no-console
    const requestOptions = {
      ...this.settings,
      method: 'GET',
      url,
      timeout: this.timeout,
      cancelToken: source.token,
    };

    return new Promise((resolve) => {
      axios(requestOptions)
        .then((response) => {
          if (!response || response.status !== 200) {
            clearTimeout(this.timeoutTable[url]);
            return resolve({ error: response.error, data: response });
          } else if (this.settings.responseType === 'stream') {
            response.data.pipe(writeable);
            const chunks = [];
            writeable.on("data", function (chunk) {
              chunks.push(chunk);
            });
            writeable.on("end", function () {
              xmlParse(Buffer.concat(chunks));
            });
          }
          return xmlParse(response.data);
        })
        .then(data => resolve({ error: null, data }))
        .catch(error => {
          let message = (axios.isCancel(error)) ? 'request timed out' : error.stack; 
          resolve({ error: message, data: {} });
        });

      this.initializeTimeout(url, resolve);
    });
  }

  /**
   * Timeouts are necessary for large xml trees. This will cancel the call if the request is taking
   * too long, but will still allow the promises to resolve.
   *
   * @private
   * @param {string} url - url to use as a hash in the timeoutTable
   * @param {Promise} requester - the promise that creates the web request to the url
   * @param {Function} callback - the resolve method is used here to resolve the parent promise
   */
  initializeTimeout(url, callback) {
    // this resolves instead of rejects in order to allow other requests to continue
    this.timeoutTable[url] = setTimeout(() => {
      source.cancel('Operation canceled by the user.');

      callback({
        error: `request timed out after ${this.timeout} milliseconds`,
        data: {},
      });
    }, this.timeout);
  }

  /**
   * Recursive function that will go through a sitemaps tree and get all the sites
   *
   * @private
   * @recursive
   * @param {string} url - the Sitemaps url (e.g http://wp.seantburke.com/sitemap.xml)
   * @returns {Promise<SitesArray> | Promise<ParseData>}
   */
  crawl(url) {
    return new Promise((resolve) => {
      this.parse(url).then(({ error, data }) => {
        // The promise resolved, remove the timeout
        clearTimeout(this.timeoutTable[url]);

        if (error) {
          // Fail silently
          if (this.debug) console.debug('[Debug]:', error); // eslint-disable-line no-console
          else if (this.progress) process.stderr.write('x');
          return resolve([]);
        } else if (data && data.urlset && data.urlset.url) {
          const sites = data.urlset.url.map(site => site.loc && site.loc[0]);
          if (this.debug) console.debug('[Debug]:', sites.length, ' sites retrieved'); // eslint-disable-line no-console
          else if (this.progress) process.stdout.write('.');

          return resolve([].concat(sites));
        } else if (data && data.sitemapindex) {
          // Map each child url into a promise to create an array of promises
          const sitemap = data.sitemapindex.sitemap.map(map => map.loc && map.loc[0]);
          const promiseArray = sitemap.map(site => this.crawl(site));
          if (this.debug) console.debug('[Debug]: Diving deeper into', sitemap.length, 'more sitemaps'); // eslint-disable-line no-console
          else if (this.progress) process.stdout.write('↓');

          // Make sure all the promises resolve then filter and reduce the array
          return Promise.all(promiseArray).then(results => {
            const sites = results.filter(result => !result.error)
              .reduce((prev, curr) => prev.concat(curr), []);

            return resolve(sites);
          });
        }
        // Fail silently
        return resolve([]);
      });
    });
  }


  /**
   * /**
   * Gets the sites from a sitemap.xml with a given URL
   * @deprecated
   * @param {string} url - url to query
   * @param {getSitesCallback} callback - callback for sites and error
   * @callback
   */
  getSites(url = this.url, callback) {
    console.warn(  // eslint-disable-line no-console
      'function getSites() is deprecated, please use the function fetch()'
    );

    let err = {};
    let sites = [];
    this.fetch(url).then(response => {
      sites = response.sites;
    }).catch(error => {
      err = error;
    });
    return callback(err, sites);
  }
}

/**
 * Callback for the getSites method
 *
 * @callback getSitesCallback
 * @param {Object} error - error from callback
 * @param {Array} sites - an Array of sitemaps
 */

/**
 * Timeout in milliseconds
 *
 * @typedef {Number} Timeout
 * the number of milliseconds before all requests timeout. The promises will still resolve so
 * you'll still receive parts of the request, but maybe not all urls
 * default is 15000 which is 15 seconds
 */

/**
 * Resolve handler type for the promise in this.parse()
 *
 * @typedef {Object} ParseData
 *
 * @property {Error} error that either comes from `xmlParse` or `request` or custom error
 * @property {Object} data
 * @property {string} data.url - URL of sitemap
 * @property {Array} data.urlset - Array of returned URLs
 * @property {string} data.urlset.url - single Url
 * @property {Object} data.sitemapindex - index of sitemap
 * @property {string} data.sitemapindex.sitemap - Sitemap
 * @example {
 *   error: "There was an error!"
 *   data: {
 *     url: 'linkedin.com',
 *     urlset: [{
 *       url: 'www.linkedin.com/project1'
 *     },[{
 *       url: 'www.linkedin.com/project2'
 *     }]
 *   }
 * }
 */

/**
 * Resolve handler type for the promise in this.parse()
 *
 * @typedef {Object} SitesData
 *
 * @property {string} url - the original url used to query the data
 * @property {SitesArray} sites
 * @example {
 *   url: 'linkedin.com/sitemap.xml',
 *   sites: [
 *     'linkedin.com/project1',
 *     'linkedin.com/project2'
 *   ]
 * }
 */

/**
 * An array of urls
 *
 * @typedef {String[]} SitesArray
 * @example [
 *   'www.google.com',
 *   'www.linkedin.com'
 * ]
 */
