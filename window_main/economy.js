const { shell } = require("electron");

const { differenceInCalendarDays } = require("date-fns");

const db = require("../shared/database");
const pd = require("../shared/player-data");
const { createDiv } = require("../shared/dom-fns");
const { createSelect } = require("../shared/select");
const { addCardHover } = require("../shared/card-hover");
const {
  collectionSortRarity,
  get_card_image,
  get_set_scryfall,
  getReadableEvent
} = require("../shared/util");

const DataScroller = require("./data-scroller");
const {
  formatNumber,
  formatPercent,
  resetMainContainer,
  toggleArchived
} = require("./renderer-util");

const byId = id => document.getElementById(id);
const vaultPercentFormat = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
};
var filterEconomy = "All";
let showArchived = false;
var daysago = 0;
var dayList = [];
let sortedChanges = [];

class economyDay {
  constructor(
    goldEarned = 0,
    gemsEarned = 0,
    goldSpent = 0,
    gemsSpent = 0,
    cardsEarned = 0,
    vaultProgress = 0.0,
    expEarned = 0
  ) {
    this.goldEarned = goldEarned;
    this.gemsEarned = gemsEarned;
    this.goldSpent = goldSpent;
    this.gemsSpent = gemsSpent;
    this.cardsEarned = cardsEarned;
    this.vaultProgress = vaultProgress;
    this.expEarned = expEarned;
  }
}

// These should match the full text of the event
const economyTransactionContextsMap = {
  "Booster.Open": "Booster Open",
  "Event.GrantCardPool": "Event Card Pool",
  "Event.PayEntry": "Pay Event Entry",
  "Event.Season.Constructed.Payout": "Constructed Season Rewards",
  "Event.Season.Limited.Payout": "Limited Season Rewards",
  "PlayerReward.OnMatchCompletedDaily": "Player Rewards",
  PurchasedCosmetic: "Cosmetic Purchase",
  "Quest.Completed": "Quest Completed",
  Store: "Store Transaction",
  "Store.Fulfillment": "Store Transaction",
  "Store.Fulfillment.Chest": "Store Transaction",
  "Store.Fulfillment.Chest.ProgressionRewards": "Store Transaction",
  "Store.Fulfillment.Boosters": "Store Booster Purchase",
  "Store.Fulfillment.Gems": "Store Gems Purchase",
  "WildCard.Redeem": "Redeem Wildcard",
  "Vault.Complete": "Vault Opening",
  "PlayerReward.OnMatchCompletedWeekly": "Weekly Rewards",
  "PlayerProgression.OrbSpend": "Orb Spend",
  "Track.Progress": "Track Progress",
  "Track.RewardTier.Updated": "Mastery Pass Purchase"
};

const trackCodeMap = {
  BattlePass_M20: "Core Set 2020",
  EarlyPlayerProgression: "New Player Experience"
};

function localDateFormat(date) {
  return `<local-time datetime="${date.toISOString()}"
    month="short"
    day="numeric"
    hour="numeric"
    minute="numeric">
    ${date.toString()}
  </local-time>`;
}

function localDayDateFormat(date) {
  return `<local-time datetime="${date.toISOString()}"
    year="numeric"
    month="long"
    day="numeric">
    ${date.toDateString()}
  </local-time>`;
}

function getReadableTrack(trackCode) {
  return trackCodeMap[trackCode] || trackCode;
}

function getReadableQuest(questCode) {
  // FIXME: Can we get a human readable quest name?
  // For now lets just use a small portion of the ID.
  return `#${questCode.substring(0, 6)}`;
}

//
function get_colation_set(collationid) {
  var ret = "";
  Object.keys(db.sets).forEach(function(setName) {
    if (db.sets[setName].collation == collationid) {
      ret = setName;
    }
  });

  return ret;
}

//
function get_card_art(cardObj) {
  if (typeof cardObj !== "object") {
    cardObj = db.card(cardObj);
  }

  if (!cardObj) {
    return "../images/notfound.png";
  } else {
    return "https://img.scryfall.com/cards" + cardObj.images.art_crop;
  }
}

function getPrettyContext(context, full = true) {
  if (context == undefined || !context) {
    return "-";
  }

  if (context.startsWith("Track.Progress")) {
    const trackCode = context.substring(15);
    return full
      ? `Track Progress: ${getReadableTrack(trackCode)}`
      : "Track Progress";
  }

  if (context.startsWith("Event.Prize")) {
    const eventCode = context.substring(12);
    return full ? `Event Prize: ${getReadableEvent(eventCode)}` : "Event Prize";
  }

  if (context.startsWith("Quest.Completed")) {
    const questCode = context.substring(16);
    return full
      ? `Quest Completed: ${getReadableQuest(questCode)}`
      : "Quest Completed";
  }

  const pretty = economyTransactionContextsMap[context];

  // If there's no valid pretty context keep the code as is.
  return pretty || context;
}

function openEconomyTab(dataIndex = 25, scrollTop = 0) {
  const mainDiv = resetMainContainer();
  createEconomyUI(mainDiv);
  const dataScroller = new DataScroller(
    mainDiv,
    renderData,
    20,
    sortedChanges.length
  );
  dataScroller.render(dataIndex, scrollTop);
}

// return val = how many rows it rendered into container
function renderData(container, index) {
  // for performance reasons, we leave changes order mostly alone
  // to display most-recent-first, we use a reverse index
  const revIndex = sortedChanges.length - index - 1;
  const change = sortedChanges[revIndex];

  if (!change) return 0;
  if (change.archived && !showArchived) return 0;

  // print out daily summaries but no sub-events
  if (
    filterEconomy === "Day Summaries" &&
    daysago !== differenceInCalendarDays(new Date(), new Date(change.date))
  ) {
    container.appendChild(createDayHeader(change));
    return 1;
  }

  const selectVal = getPrettyContext(change.context, false);
  if (filterEconomy !== "All" && selectVal !== filterEconomy) {
    return 0;
  }

  let rowsAdded = 0;

  if (daysago != differenceInCalendarDays(new Date(), new Date(change.date))) {
    container.appendChild(createDayHeader(change));
    rowsAdded++;
  }

  // Track Progress txns are mostly redundant with inventory change txns
  // Non-duplicate data (should be) only on txns with level changes
  if (selectVal === "Track Progress") {
    if (!change.trackDiff) return rowsAdded;
    const lvlDelta = Math.abs(
      (change.trackDiff.currentLevel || 0) - (change.trackDiff.oldLevel || 0)
    );
    if (!lvlDelta) return rowsAdded;
  }

  const div = createChangeRow(change, change.id);
  container.appendChild(div);
  const flexRight = byId(change.id);
  if (flexRight.scrollWidth > flexRight.clientWidth) {
    flexRight.addEventListener("mousewheel", function(e) {
      this.scrollLeft += parseInt(e.deltaY / 2);
      e.preventDefault();
    });
  }
  rowsAdded++;

  return rowsAdded;
}

function createDayHeader(change) {
  daysago = differenceInCalendarDays(new Date(), new Date(change.date));
  const headerGrid = createDiv(["economy_title"]);

  const tx = createDiv(["economy_sub"]);
  tx.style.lineHeight = "64px";
  let ntx;
  const up = createDiv(["economy_up"], "", { title: "increase" });
  const down = createDiv(["economy_down"], "", { title: "decrease" });

  // Title
  const gridTitle = createDiv(["flex_item"]);
  gridTitle.style.gridArea = "1 / 1 / auto / 2";
  gridTitle.style.lineHeight = "64px";

  if (daysago == 0) gridTitle.innerHTML = "Today";
  if (daysago == 1) gridTitle.innerHTML = "Yesterday";
  if (daysago > 1) {
    let date = new Date(change.date);
    date = new Date(date.setHours(0, 0, 0, 0));
    gridTitle.innerHTML = localDayDateFormat(date);
  }
  headerGrid.appendChild(gridTitle);

  // Cards
  const gridCards = createDiv(["economy_metric"]);
  gridCards.style.gridArea = "1 / 2 / auto / 3";
  const icca = createDiv(["economy_card"], "", { title: "Cards" });
  const catx = tx.cloneNode(true);
  catx.innerHTML = formatNumber(dayList[daysago].cardsEarned);
  gridCards.appendChild(icca);
  const upcontca = createDiv(["economy_delta"]);
  upcontca.style.width = "auto";
  upcontca.appendChild(catx);
  upcontca.appendChild(up.cloneNode(true));
  gridCards.appendChild(upcontca);
  headerGrid.appendChild(gridCards);

  // Vault
  const gridVault = createDiv(["economy_metric"]);
  gridVault.style.gridArea = "1 / 3 / auto / 4";
  gridVault.appendChild(createDiv(["economy_vault"], "", { title: "Vault" }));
  const vatx = tx.cloneNode(true);
  const deltaPercent = dayList[daysago].vaultProgress / 100.0;
  vatx.innerHTML = formatPercent(deltaPercent, vaultPercentFormat);
  const upcontva = createDiv(["economy_delta"]);
  upcontva.style.width = "auto";
  upcontva.appendChild(vatx);
  upcontva.appendChild(up.cloneNode(true));
  gridVault.appendChild(upcontva);
  headerGrid.appendChild(gridVault);

  // Gold
  const gridGold = createDiv(["economy_metric"]);
  gridGold.style.gridArea = "1 / 4 / auto / 5";
  gridGold.appendChild(createDiv(["economy_gold_med"], "", { title: "Gold" }));

  const upcontgo = createDiv(["economy_delta"]);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(dayList[daysago].goldEarned);
  upcontgo.appendChild(ntx);
  upcontgo.appendChild(up.cloneNode(true));
  gridGold.appendChild(upcontgo);

  const dncontgo = createDiv(["economy_delta"]);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(dayList[daysago].goldSpent);
  dncontgo.appendChild(ntx);
  dncontgo.appendChild(down.cloneNode(true));
  gridGold.appendChild(dncontgo);
  headerGrid.appendChild(gridGold);

  // Gems
  const gridGems = createDiv(["economy_metric"]);
  gridGems.style.gridArea = "1 / 5 / auto / 6";
  let icge = createDiv(["economy_gems_med"], "", { title: "Gems" });
  gridGems.appendChild(icge);

  const upcontge = createDiv(["economy_delta"]);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(dayList[daysago].gemsEarned);
  upcontge.appendChild(ntx);
  upcontge.appendChild(up.cloneNode(true));
  gridGems.appendChild(upcontge);

  const dncontge = createDiv(["economy_delta"]);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(dayList[daysago].gemsSpent);
  dncontge.appendChild(ntx);
  dncontge.appendChild(down.cloneNode(true));
  gridGems.appendChild(dncontge);
  headerGrid.appendChild(gridGems);

  // Experience
  const gridExp = createDiv(["economy_metric"]);
  gridExp.style.gridArea = "1 / 6 / auto / 7";
  gridExp.appendChild(createDiv(["economy_exp"], "", { title: "Experience" }));
  const xptx = tx.cloneNode(true);
  xptx.innerHTML = formatNumber(dayList[daysago].expEarned);
  const upcontxp = createDiv(["economy_delta"]);
  upcontxp.style.width = "auto";
  upcontxp.appendChild(xptx);
  upcontxp.appendChild(up.cloneNode(true));
  gridExp.appendChild(upcontxp);
  headerGrid.appendChild(gridExp);

  return headerGrid;
}

function createChangeRow(change, economyId) {
  // The next ~200 lines of code will add elements to these two containers
  var flexBottom = createDiv(["flex_bottom"]);
  var flexRight = createDiv(["tiny_scroll", "list_economy_awarded"], "", {
    id: economyId
  });

  let checkGemsPaid = false;
  let checkGoldPaid = false;
  let checkCardsAdded = false;
  let checkBoosterAdded = false;
  let checkAetherized = false;
  let checkWildcardsAdded = false;
  let checkGemsEarnt = false;
  let checkGoldEarnt = false;
  let checkSkinsAdded = false;

  var bon, bos;

  const fullContext = getPrettyContext(change.originalContext);

  if (fullContext === "Booster Open") {
    change.delta.boosterDelta.forEach(function(booster) {
      var set = get_colation_set(booster.collationId);

      var bos = createDiv(["set_logo"]);
      bos.style.backgroundImage =
        "url(../images/sets/" + db.sets[set].code + ".png)";
      bos.title = set;

      var bon = createDiv();
      bon.style.lineHeight = "32px";
      bon.classList.add("economy_sub");

      bon.innerHTML = "x" + Math.abs(booster.count);

      flexBottom.appendChild(bos);
      flexBottom.appendChild(bon);
    });

    checkWildcardsAdded = true;
    checkCardsAdded = true;
    checkAetherized = true;
  } else if (
    fullContext.includes("Store") ||
    fullContext.includes("Purchase")
  ) {
    if (change.delta.goldDelta > 0) checkGoldEarnt = true;
    if (change.delta.goldDelta < 0) checkGoldPaid = true;
    if (change.delta.gemsDelta > 0) checkGemsEarnt = true;
    if (change.delta.gemsDelta < 0) checkGemsPaid = true;

    checkBoosterAdded = true;
    checkWildcardsAdded = true;
    checkCardsAdded = true;
    checkSkinsAdded = true;
    checkAetherized = true;
  } else if (fullContext === "Booster Redeem") {
    checkGemsPaid = true;
    checkGoldPaid = true;
    checkBoosterAdded = true;
  } else if (fullContext === "Pay Event Entry") {
    checkGemsPaid = true;
    checkGoldPaid = true;

    bos = createDiv(["economy_ticket_med"]);
    bos.title = "Event Entry";

    flexRight.appendChild(bos);
  } else if (fullContext === "Redeem Wildcard") {
    let imgUri = "";
    let title = "";
    let count = 0;

    const renderWild = count => {
      if (!count) return;
      count = Math.abs(count);
      bos = createDiv(["economy_wc"]);
      bos.title = title;
      bos.style.backgroundImage = "url(../images/" + imgUri + ".png)";

      bon = createDiv();
      bon.style.lineHeight = "32px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "x" + count;

      flexBottom.appendChild(bos);
      flexBottom.appendChild(bon);
    };

    if (change.delta.wcCommonDelta !== undefined) {
      imgUri = "wc_common";
      title = "Common Wildcard";
      count = change.delta.wcCommonDelta;
      renderWild(count);
    }
    if (change.delta.wcUncommonDelta !== undefined) {
      imgUri = "wc_uncommon";
      title = "Uncommon Wildcard";
      count = change.delta.wcUncommonDelta;
      renderWild(count);
    }
    if (change.delta.wcRareDelta !== undefined) {
      imgUri = "wc_rare";
      title = "Rare Wildcard";
      count = change.delta.wcRareDelta;
      renderWild(count);
    }
    if (change.delta.wcMythicDelta !== undefined) {
      imgUri = "wc_mythic";
      title = "Mythic Wildcard";
      count = change.delta.wcMythicDelta;
      renderWild(count);
    }

    checkCardsAdded = true;
    checkAetherized = true;
  } else {
    checkGemsEarnt = true;
    checkGoldEarnt = true;
    checkBoosterAdded = true;
    checkCardsAdded = true;
    checkAetherized = true;
    checkWildcardsAdded = true;
    checkSkinsAdded = true;
  }

  if (checkGemsPaid && change.delta.gemsDelta) {
    bos = createDiv(["economy_gems"]);
    bos.title = "Gems";

    bon = createDiv();
    bon.style.lineHeight = "32px";
    bon.classList.add("economy_sub");
    bon.innerHTML = formatNumber(Math.abs(change.delta.gemsDelta));

    flexBottom.appendChild(bos);
    flexBottom.appendChild(bon);
  }

  if (checkGoldPaid && change.delta.goldDelta) {
    bos = createDiv(["economy_gold"]);
    bos.title = "Gold";

    bon = createDiv();
    bon.style.lineHeight = "32px";
    bon.classList.add("economy_sub");
    bon.innerHTML = formatNumber(Math.abs(change.delta.goldDelta));

    flexBottom.appendChild(bos);
    flexBottom.appendChild(bon);
  }

  if (checkGemsEarnt && change.delta.gemsDelta) {
    bos = createDiv(["economy_gems_med"]);
    bos.title = "Gems";

    bon = createDiv();
    bon.style.lineHeight = "64px";
    bon.classList.add("economy_sub");
    bon.innerHTML = formatNumber(Math.abs(change.delta.gemsDelta));

    flexRight.appendChild(bos);
    flexRight.appendChild(bon);
  }

  if (checkGoldEarnt && change.delta.goldDelta) {
    bos = createDiv(["economy_gold_med"]);
    bos.title = "Gold";

    bon = createDiv();
    bon.style.lineHeight = "64px";
    bon.classList.add("economy_sub");
    bon.innerHTML = formatNumber(Math.abs(change.delta.goldDelta));

    flexRight.appendChild(bos);
    flexRight.appendChild(bon);
  }

  if (change.trackDiff) {
    const lvlDelta = Math.abs(
      (change.trackDiff.currentLevel || 0) - (change.trackDiff.oldLevel || 0)
    );
    if (lvlDelta) {
      bos = createDiv(["economy_mastery_med"]);
      bos.title = `Mastery Level (${pd.economy.trackName})`;

      bon = createDiv();
      bon.style.lineHeight = "64px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "+" + formatNumber(lvlDelta);

      flexRight.appendChild(bos);
      flexRight.appendChild(bon);
    }
  }

  if (change.orbCountDiff) {
    const orbDelta = Math.abs(
      (change.orbCountDiff.currentOrbCount || 0) -
        (change.orbCountDiff.oldOrbCount || 0)
    );
    if (orbDelta) {
      flexRight.appendChild(createDiv(["economy_orb"], "", { title: "Orbs" }));
      bon = createDiv(["economy_sub"], formatNumber(orbDelta));
      bon.style.lineHeight = "64px";
      flexRight.appendChild(bon);
    }
  }

  if (change.xpGained) {
    flexRight.appendChild(
      createDiv(["economy_exp"], "", { title: "Experience" })
    );
    bon = createDiv(["economy_sub"], formatNumber(change.xpGained));
    bon.style.lineHeight = "64px";
    flexRight.appendChild(bon);
  }

  if (checkBoosterAdded && change.delta.boosterDelta) {
    change.delta.boosterDelta.forEach(function(booster) {
      var set = get_colation_set(booster.collationId);

      var bos = createDiv(["set_logo_med"]);
      bos.style.backgroundImage =
        "url(../images/sets/" + db.sets[set].code + ".png)";
      bos.title = set;

      var bon = createDiv();
      bon.style.lineHeight = "64px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "x" + Math.abs(booster.count);

      flexRight.appendChild(bos);
      flexRight.appendChild(bon);
    });
  }

  if (checkWildcardsAdded) {
    if (change.delta.wcCommonDelta) {
      bos = createDiv(["economy_wc"]);
      bos.title = "Common Wildcard";
      bos.style.backgroundImage = "url(../images/wc_common.png)";
      bon = createDiv();
      bon.style.lineHeight = "64px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "x" + Math.abs(change.delta.wcCommonDelta);
      flexRight.appendChild(bos);
      flexRight.appendChild(bon);
    }

    if (change.delta.wcUncommonDelta) {
      bos = createDiv(["economy_wc"]);
      bos.title = "Uncommon Wildcard";
      bos.style.backgroundImage = "url(../images/wc_uncommon.png)";
      bon = createDiv();
      bon.style.lineHeight = "64px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "x" + Math.abs(change.delta.wcUncommonDelta);
      flexRight.appendChild(bos);
      flexRight.appendChild(bon);
    }

    if (change.delta.wcRareDelta) {
      bos = createDiv(["economy_wc"]);
      bos.title = "Rare Wildcard";
      bos.style.backgroundImage = "url(../images/wc_rare.png)";
      bon = createDiv();
      bon.style.lineHeight = "64px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "x" + Math.abs(change.delta.wcRareDelta);
      flexRight.appendChild(bos);
      flexRight.appendChild(bon);
    }
    if (change.delta.wcMythicDelta) {
      bos = createDiv(["economy_wc"]);
      bos.title = "Mythic Wildcard";
      bos.style.backgroundImage = "url(../images/wc_mythic.png)";
      bon = createDiv();
      bon.style.lineHeight = "64px";
      bon.classList.add("economy_sub");
      bon.innerHTML = "x" + Math.abs(change.delta.wcMythicDelta);
      flexRight.appendChild(bos);
      flexRight.appendChild(bon);
    }
  }

  if (checkCardsAdded && change.delta.cardsAdded !== undefined) {
    change.delta.cardsAdded.sort(collectionSortRarity);
    change.delta.cardsAdded.forEach(function(grpId) {
      var card = db.card(grpId);

      var d = createDiv(["inventory_card"]);
      d.style.width = "39px";

      var img = document.createElement("img");
      img.classList.add("inventory_card_img");
      img.style.width = "39px";
      img.src = get_card_image(card);

      d.appendChild(img);

      flexRight.appendChild(d);
      addCardHover(img, card);

      img.addEventListener("click", () => {
        if (db.card(grpId).dfc == "SplitHalf") {
          card = db.card(card.dfcId);
        }
        //let newname = card.name.split(' ').join('-');
        shell.openExternal(
          "https://scryfall.com/card/" +
            get_set_scryfall(card.set) +
            "/" +
            card.cid +
            "/" +
            card.name
        );
      });
    });
  }

  if (checkAetherized && change.aetherizedCards !== undefined) {
    change.aetherizedCards.forEach(function(obj) {
      var grpId = obj.grpId;
      var card = db.card(grpId);
      let draw = false;
      if (card) {
        if (change.delta.cardsAdded) {
          if (change.delta.cardsAdded.indexOf(grpId) == -1) {
            draw = true;
          }
        } else {
          draw = true;
        }
      }
      if (draw) {
        var d = createDiv(["inventory_card"]);
        d.style.width = "39px";

        var img = document.createElement("img");
        img.classList.add("inventory_card_img");
        img.classList.add("inventory_card_aetherized");
        img.style.width = "39px";
        img.src = get_card_image(card);

        if (card.rarity) {
          // only uncommons and commons go to vault
          let vaultProgressDelta =
            card.rarity === "uncommon" ? 1 / 300 : 1 / 900;
          img.title =
            "Vault:+" + formatPercent(vaultProgressDelta, vaultPercentFormat);
        }

        d.appendChild(img);
        flexRight.appendChild(d);

        addCardHover(img, card);

        img.addEventListener("click", () => {
          if (db.card(grpId).dfc == "SplitHalf") {
            card = db.card(card.dfcId);
          }
          //let newname = card.name.split(' ').join('-');
          shell.openExternal(
            "https://scryfall.com/card/" +
              get_set_scryfall(card.set) +
              "/" +
              card.cid +
              "/" +
              card.name
          );
        });
      }
    });
  }

  if (checkSkinsAdded && change.delta.artSkinsAdded !== undefined) {
    change.delta.artSkinsAdded.forEach(obj => {
      let card = db.cardFromArt(obj.artId);

      bos = createDiv(["economy_skin_art"]);
      bos.title = card.name + " Skin";
      bos.style.backgroundImage = `url("${get_card_art(card)}")`;

      flexRight.appendChild(bos);
    });
  }

  // DOM hierarchy is:
  // changeRow
  //   flexLeft
  //      flexTop
  //      flexBottom
  //   flexRight

  var flexTop = createDiv(["flex_top", "economy_sub"]);
  flexTop.style.lineHeight = "32px";

  flexTop.appendChild(
    createDiv(
      [],
      `<span title="${change.originalContext}">${fullContext}</span>`
    )
  );

  var niceDate = localDateFormat(new Date(change.date));
  flexTop.appendChild(createDiv(["list_economy_time"], niceDate));

  var flexLeft = createDiv(["flex_item"]);
  flexLeft.style.flexDirection = "column";
  flexLeft.appendChild(flexTop);
  flexLeft.appendChild(flexBottom);

  var changeRow = createDiv([economyId, "list_economy"]);
  changeRow.appendChild(flexLeft);
  changeRow.appendChild(flexRight);

  var deleteButton = document.createElement("div");
  deleteButton.classList.add("flex_item");
  deleteButton.classList.add(economyId + "_del");
  const archiveClass = change.archived
    ? "list_item_unarchive"
    : "list_item_archive";
  deleteButton.title = change.archived
    ? "restore"
    : "archive (will not delete data)";
  deleteButton.classList.add(archiveClass);

  changeRow.appendChild(deleteButton);

  const archiveCallback = e => {
    e.stopPropagation();
    if (!change.archived) {
      changeRow.style.height = "0px";
      changeRow.style.overflow = "hidden";
    }
    toggleArchived(economyId);
  };
  deleteButton.addEventListener("click", archiveCallback);

  return changeRow;
}

function createEconomyUI(mainDiv) {
  daysago = -999;
  dayList = [];
  sortedChanges = [...pd.transactionList];
  sortedChanges.sort(compare_economy);

  const topSelectItems = ["All", "Day Summaries"];
  const contextCounts = {};

  for (let n = 0; n < sortedChanges.length; n++) {
    const change = sortedChanges[n];
    if (change === undefined) continue;
    if (change.archived && !showArchived) continue;

    if (
      daysago != differenceInCalendarDays(new Date(), new Date(change.date))
    ) {
      daysago = differenceInCalendarDays(new Date(), new Date(change.date));
      dayList[daysago] = new economyDay();
      // console.log("new day", change.date);
    }

    const selectVal = getPrettyContext(change.context, false);
    contextCounts[selectVal] = (contextCounts[selectVal] || 0) + 1;

    if (change.delta.gemsDelta != undefined) {
      if (change.delta.gemsDelta > 0)
        dayList[daysago].gemsEarned += change.delta.gemsDelta;
      else dayList[daysago].gemsSpent += Math.abs(change.delta.gemsDelta);
    }
    if (change.delta.goldDelta != undefined) {
      if (change.delta.goldDelta > 0)
        dayList[daysago].goldEarned += change.delta.goldDelta;
      else dayList[daysago].goldSpent += Math.abs(change.delta.goldDelta);

      // console.log(economyId, "> ", change.date, " > ", change.delta.goldDelta);
    }

    if (change.delta.cardsAdded) {
      dayList[daysago].cardsEarned += change.delta.cardsAdded.length;
    }
    if (change.delta.vaultProgressDelta > 0) {
      dayList[daysago].vaultProgress += change.delta.vaultProgressDelta;
    }

    if (change.xpGained > 0) {
      dayList[daysago].expEarned += change.xpGained;
    }
  }
  const selectItems = Object.keys(contextCounts);
  selectItems.sort(
    (a, b) => contextCounts[b] - contextCounts[a] || a.localeCompare(b)
  );

  const div = createDiv(["list_economy_top", "flex_item"]);

  const selectdiv = createDiv();
  selectdiv.style.margin = "auto auto auto 0px";
  selectdiv.style.display = "flex";
  const select = createSelect(
    selectdiv,
    [...topSelectItems, ...selectItems],
    filterEconomy,
    res => {
      filterEconomy = res;
      openEconomyTab();
    },
    "query_select",
    context =>
      context in contextCounts
        ? `${context} (${contextCounts[context]})`
        : context
  );

  const archiveCont = document.createElement("label");
  archiveCont.style.marginTop = "4px";
  archiveCont.classList.add("check_container", "hover_label");
  archiveCont.innerHTML = "archived";
  const archiveCheckbox = document.createElement("input");
  archiveCheckbox.type = "checkbox";
  archiveCheckbox.id = "economy_query_archived";
  archiveCheckbox.addEventListener("click", () => {
    showArchived = archiveCheckbox.checked;
    openEconomyTab();
  });
  archiveCheckbox.checked = showArchived;
  archiveCont.appendChild(archiveCheckbox);
  const archiveSpan = document.createElement("span");
  archiveSpan.classList.add("checkmark");
  archiveCont.appendChild(archiveSpan);
  selectdiv.appendChild(archiveCont);

  //$$("#query_select.select_button")[0].innerHTML = filterEconomy;
  div.appendChild(selectdiv);

  const tx = createDiv();
  tx.style.lineHeight = "64px";
  tx.classList.add("economy_sub");
  let ntx;

  const icbo = createDiv(["economy_wc_med", "wc_booster"], "", {
    title: "Boosters"
  });
  icbo.style.marginLeft = "24px";
  div.appendChild(icbo);
  ntx = tx.cloneNode(true);
  let total = 0;
  pd.economy.boosters.forEach(booster => (total += booster.count));
  ntx.innerHTML = total;
  div.appendChild(ntx);

  const icva = createDiv(["economy_vault"], "", { title: "Vault" });
  icva.style.marginLeft = "24px";
  div.appendChild(icva);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatPercent(pd.economy.vault / 100, vaultPercentFormat);
  div.appendChild(ntx);

  const icwcc = createDiv(["economy_wc_med", "wc_common"]);
  icwcc.title = "Common Wildcards";
  div.appendChild(icwcc);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(pd.economy.wcCommon);
  div.appendChild(ntx);

  const icwcu = createDiv(["economy_wc_med", "wc_uncommon"]);
  icwcu.title = "Uncommon Wildcards";
  div.appendChild(icwcu);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(pd.economy.wcUncommon);
  div.appendChild(ntx);

  const icwcr = createDiv(["economy_wc_med", "wc_rare"]);
  icwcr.title = "Rare Wildcards";
  div.appendChild(icwcr);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(pd.economy.wcRare);
  div.appendChild(ntx);

  const icwcm = createDiv(["economy_wc_med", "wc_mythic"]);
  icwcm.title = "Mythic Wildcards";
  div.appendChild(icwcm);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(pd.economy.wcMythic);
  div.appendChild(ntx);

  const icgo = createDiv(["economy_gold_med"]);
  icgo.title = "Gold";
  div.appendChild(icgo);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(pd.economy.gold);
  div.appendChild(ntx);

  const icge = createDiv(["economy_gems_med"]);
  icge.style.marginLeft = "24px";
  icge.title = "Gems";
  div.appendChild(icge);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(pd.economy.gems);
  div.appendChild(ntx);

  const masteryLevel = pd.economy.currentLevel + 1;
  const iclvl = createDiv(["economy_mastery_med"]);
  iclvl.title = `Mastery Level (${pd.economy.trackName})`;
  div.appendChild(iclvl);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = formatNumber(masteryLevel);
  div.appendChild(ntx);

  const icxp = createDiv(["economy_exp"], "", { title: "Experience" });
  icxp.style.marginLeft = "24px";
  div.appendChild(icxp);
  ntx = tx.cloneNode(true);
  ntx.innerHTML = pd.economy.currentExp || 0;
  div.appendChild(ntx);

  mainDiv.appendChild(div);
  daysago = -1;
}

// Compare two economy events
function compare_economy(a, b) {
  if (a === undefined) return 0;
  if (b === undefined) return 0;

  return Date.parse(a.date) - Date.parse(b.date);
}

module.exports = {
  openEconomyTab: openEconomyTab
};
