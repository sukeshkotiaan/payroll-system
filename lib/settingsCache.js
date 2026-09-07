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
  // Use lean() so all raw MongoDB fields are accessible — including legacy
  // top-level fields (basicPercent, ptSlabs, esicRate …) stored before the
  // locationSettings migration was introduced.
  _cache = await Settings.findOne().lean();
  _cacheTime = Date.now();
  return _cache;
};

const invalidateCache = () => {
  _cache = null;
  _cacheTime = 0;
};

module.exports = { getSettings, invalidateCache };
