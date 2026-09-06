/**
 * In-process Settings cache — 60-second TTL.
 * Avoids a MongoDB round-trip on every payroll calculation, login check,
 * and OT rate lookup. Call invalidateCache() whenever Settings are saved.
 */
const Settings = require('../models/Settings');

let _cache = null;
let _cacheTime = 0;
const TTL = 60 * 1000; // 60 seconds

const getSettings = async () => {
  if (_cache && (Date.now() - _cacheTime) < TTL) {
    return _cache;
  }
  _cache = await Settings.findOne();
  _cacheTime = Date.now();
  return _cache;
};

const invalidateCache = () => {
  _cache = null;
  _cacheTime = 0;
};

module.exports = { getSettings, invalidateCache };
