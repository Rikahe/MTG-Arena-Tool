/*
global
  debugLog
  firstPass
  logLanguage
*/
// Utility functions that belong only to background
const { ipcRenderer: ipc } = require("electron");
const _ = require("lodash");
const parse = require("date-fns").parse;

const {
  IPC_BACKGROUND,
  IPC_MAIN,
  IPC_OVERLAY
} = require("../shared/constants.js");
const pd = require("../shared/player-data.js");

// These were tested briefly , but hey are all taken from actual logs
// At most some format from date-fns could be wrong;
// https://date-fns.org/v2.0.0-alpha.7/docs/parse
let dateLangs = [
  "dd.MM.yyyy HH:mm:ss",
  "dd/MM/yyyy HH:mm:ss",
  "M/dd/yyyy hh:mm:ss aa",
  "dd/MM/yyyy hh:mm:ss aa",
  "yyyy-MM-dd A HH:mm:ss",
  "yyyy/MM/dd HH:mm:ss"
];

// throws an error if it fails
function parseWotcTime(dateStr) {
  let date = parse(dateStr, dateLangs[0], new Date());

  // This is to detect language when the one read does not match or logLanguage is not yet set
  // Defaults to current time if none matches
  if (!date || isNaN(date.getTime())) {
    dateLangs.forEach(lang => {
      let test = parse(dateStr, lang, new Date());
      if (test && !isNaN(test.getTime())) {
        //logLanguage = lang;
        //console.log(`Log datetime language detected: ${lang}`, dateStr, test);
        date = test;
      }
    });
  }

  if (!date || isNaN(date.getTime())) {
    // console.log(`Invalid date ('${dateStr}') - using current date as backup.`);
    date = new Date();
  }
  return date;
}

function normaliseFields(iterator) {
  if (typeof iterator == "object") {
    return _.transform(iterator, function(result, value, key) {
      let nkey =
        typeof key == "string" ? key.replace(/List$/, "").toLowerCase() : key;
      result[nkey] = normaliseFields(value);
    });
  }
  return iterator;
}

function unleakString(s) {
  return (" " + s).substr(1);
}

// Begin of IPC messages recievers
function ipc_send(method, arg, to = IPC_MAIN) {
  if (method == "ipc_log") {
    //
  }
  //console.log("IPC SEND", method, arg, to);
  ipc.send("ipc_switch", method, IPC_BACKGROUND, arg, to);
}

const dataBlacklist = [
  "transactionList",
  "draftList",
  "eventList",
  "matchList"
];

const overlayWhitelist = [
  "name",
  "userName",
  "arenaId",
  "arenaVersion",
  "patreon",
  "patreon_tier",
  "rank",
  "cards",
  "cardsNew",
  "settings"
];

// convenience fn to update player data singletons in all processes
// (update is destructive, be sure to use spread syntax if necessary)
function setData(data, refresh = debugLog || !firstPass) {
  const cleanData = _.omit(data, dataBlacklist);
  pd.handleSetData(null, cleanData);
  ipc_send("set_player_data", cleanData, IPC_MAIN);
  const overlayData = _.pick(cleanData, overlayWhitelist);
  ipc_send("set_player_data", overlayData, IPC_OVERLAY);
  if (refresh) ipc_send("player_data_refresh");
}

module.exports = {
  ipc_send,
  normaliseFields,
  parseWotcTime,
  setData,
  unleakString
};
