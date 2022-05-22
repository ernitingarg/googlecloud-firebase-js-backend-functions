const functions = require("firebase-functions");
const firebase = require("firebase-admin");
const request = require("request");
const fs = require("fs");
require("date-utils");
const BigNumber = require("bignumber.js");

firebase.initializeApp();
const DECIMALS = { BTC: 8, ETH: 18, USDS: 6, USDC: 6, USDT: 6 };
const available_currency = ["BTC", "ETH", "USDS", "USDC", "USDT"];
const stable_coins = ["USDC", "USDT"];

// -- Ethereum --
const Web3 = require("web3");
const Web3HDWalletProvider = require("web3-hdwallet-provider");

const ProviderUrl =
  "https://mainnet.infura.io/v3/b60ae61e3fc140268b48891205dc6f7d";
const UsdsContractAddr = "0x687d401162e47e7003B2871203fa4B1Bbf327C39";
const RebaseOwnerAddr = "0x079517E43D98D9a0C34599047D39F631aF75A8c6";
const InitialFragments = new BigNumber(100000000000000000000);
const APY_PER_DAY = 0.00026116;
// 今のところ使用しないが,APYの計算方法を記載しておく
// = 16.13920516111735%
//const APY = (Math.pow(1.00026116, 365) - 1) * 100;

// --------------

// ---- slack setup ----

const sendSlackNotification = (msg, chan) => {
  const slackUrl = "https://hooks.slack.com/services";
  const channels = {
    deposit: "/T01DBF9B7U1/B0252FUGXSQ/JqQ7Qu6dGAvM7ctwz2hM6YQk",
    error: "/T01DBF9B7U1/B024F7JSMN3/N0ulEVHAvfMgtKK381hHJ2x2",
    conversion: "/T01DBF9B7U1/B024FHRC33R/a33fU7JiIbsbNPgRivSyvmPT",
    withdrawal: "/T01DBF9B7U1/B01EKKKJ94L/efi3pNPDXYjPhRYCMZt7UBMS",
  };

  if (!channels[chan]) {
    console.error(
      new Error("wrong slack channel - could not send slack notification")
    );
    return;
  }

  request.post(
    {
      uri: slackUrl + channels[chan],
      headers: { "Content-type": "application/json" },
      json: { text: msg },
    },
    function (err, res2, body) {
      res.status(200).send(msg);
    }
  );
};

exports.withdrawal_request = functions.https.onRequest(async (req, res) => {
  const db = firebase.firestore();
  switch (req.get("content-type")) {
    case "application/json":
      ({ user } = req.body);
      ({ currency } = req.body);
      ({ amount } = req.body);
      ({ to } = req.body);
      break;

    case "application/x-www-form-urlencoded":
      ({ user } = req.body);
      ({ currency } = req.body);
      ({ amount } = req.body);
      ({ to } = req.body);
      break;
  }

  if (!user || !currency || !amount || !to) {
    var msg = `withdrawal error - required fields not filled for ${JSON.stringify(
      req.body
    )}`;

    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Required fields not filled.");
    process.exit();
  }
  amount = Number(amount);

  if (!available_currency.includes(currency)) {
    var msg = `withdrawal error - unsupported currency - ${JSON.stringify(
      req.body
    )}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Specified currency is not available.");
  }

  let now = new Date();

  const data = {
    user: user,
    currency: currency,
    amount: amount,
    to: to,
    datetime: now.toFormat("YYYY-MM-DD HH24:MI:SS"),
    status: "pending",
  };

  var doc = "";

  try {
    await db.runTransaction(async (t) => {
      balancesRef = db.collection("balances").doc(user);
      pendingRef = db.collection("pending_balances").doc(user);
      balances = await t.get(balancesRef);
      pending = await t.get(pendingRef);

      const balance = balances.data()[currency];
      console.log(balance);

      if (balance >= amount) {
        var inc = {},
          dec = {};
        inc[currency] = firebase.firestore.FieldValue.increment(amount);
        dec[currency] = firebase.firestore.FieldValue.increment(-amount);
        t.set(balancesRef, dec, { merge: true });
        t.set(pendingRef, inc, { merge: true });
        doc = await db.collection("withdrawal_requests").add(data);
      } else {
        var msg = `withdrawal error - user: ${user} - insufficent balance ${balance} ${currency} - withdrawal amount: ${amount}`;
        console.error(msg);
        sendSlackNotification(msg, "error");
        res.status(500).send("Balance not enough.");
        process.exit();
      }
    });
  } catch (e) {
    var msg = `withdrawl error - user ${user} - ${e}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Internal error.");
    process.exit();
  }

  // Post to slack
  msg =
    "Ticket ID<" +
    doc.id +
    "> Withdrawal request from " +
    user +
    ": " +
    amount +
    " " +
    currency +
    " to " +
    to;
  console.log(msg);
  sendSlackNotification(msg, "withdrawal");
});

exports.withdrawal_cancel = functions.https.onRequest(async (req, res) => {
  const db = firebase.firestore();

  switch (req.get("content-type")) {
    case "application/json":
      ({ ticket_id } = req.body);
      ({ user } = req.body);
      break;

    case "application/x-www-form-urlencoded":
      ({ ticket_id } = req.body);
      ({ user } = req.body);
      break;
  }

  try {
    await db.runTransaction(async (t) => {
      balancesRef = db.collection("balances").doc(user);
      pendingRef = db.collection("pending_balances").doc(user);
      ticketRef = db.collection("withdrawal_requests").doc(ticket_id);
      balances = await t.get(balancesRef);
      pending = await t.get(pendingRef);
      ticket = await t.get(ticketRef);

      const amount = Number(ticket.data().amount);
      const currency = ticket.data().currency;
      const status = ticket.data().status;

      if (
        ticket.data().user == user &&
        status == "pending" &&
        pending.data()[currency] >= amount
      ) {
        var inc = {},
          dec = {};
        inc[currency] = firebase.firestore.FieldValue.increment(amount);
        dec[currency] = firebase.firestore.FieldValue.increment(-amount);
        t.set(balancesRef, inc, { merge: true });
        t.set(pendingRef, dec, { merge: true });
        t.set(ticketRef, { status: "canceled" }, { merge: true });
      } else {
        res.status(500).send("This ticket cannot be canceled.");
        process.exit();
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal error.");
  }
  res.status(200).send("Success.");
});

exports.withdrawal_done = functions.https.onRequest(async (req, res) => {
  const db = firebase.firestore();

  switch (req.get("content-type")) {
    case "application/json":
      ({ ticket_id } = req.body);
      ({ user } = req.body);
      break;

    case "application/x-www-form-urlencoded":
      ({ ticket_id } = req.body);
      ({ user } = req.body);
      break;
  }

  try {
    await db.runTransaction(async (t) => {
      pendingRef = db.collection("pending_balances").doc(user);
      ticketRef = db.collection("withdrawal_requests").doc(ticket_id);
      pending = await t.get(pendingRef);
      ticket = await t.get(ticketRef);

      const amount = Number(ticket.data().amount);
      const currency = ticket.data().currency;
      const status = ticket.data().status;

      if (
        ticket.data().user == user &&
        status == "pending" &&
        pending.data()[currency] >= amount
      ) {
        var dec = {};
        dec[currency] = firebase.firestore.FieldValue.increment(-amount);
        t.set(pendingRef, dec, { merge: true });
        t.set(ticketRef, { status: "done" }, { merge: true });
      } else {
        res.status(500).send("This ticket cannot be done.");
        process.exit();
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Internal error.");
  }
  res.status(200).send("Success.");
});

exports.conversion_request = functions.https.onRequest(async (req, res) => {
  const db = firebase.firestore();

  switch (req.get("content-type")) {
    case "application/json":
      ({ user } = req.body);
      ({ from_currency } = req.body);
      ({ to_currency } = req.body);
      ({ amount } = req.body);
      ({ argrate } = req.body);
      break;

    case "application/x-www-form-urlencoded":
      ({ user } = req.body);
      ({ from_currency } = req.body);
      ({ to_currency } = req.body);
      ({ amount } = req.body);
      ({ argrate } = req.body);
      break;
  }

  if (!user || !from_currency || !to_currency || !amount) {
    var msg = `required fields not filled: ${JSON.stringify(req.body)}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Required fields not filled.");
    process.exit();
  }

  amount = Number(amount);
  argrate = Number(argrate);

  console.log(
    `user= ${user}`,
    `from_currency =${from_currency}`,
    `to_currency= ${to_currency}`,
    `amount= ${amount}`,
    `rate(arg)= ${argrate}`
  );

  if (!available_currency.includes(from_currency)) {
    var msg = `conversion error - from currency ${from_currency} is not supported, data: ${JSON.stringify(
      req.body
    )}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Specified currency is not available.");
  }

  if (!available_currency.includes(to_currency)) {
    var msg = `conversion error - to currency ${to_currency} is not supported, data: ${JSON.stringify(
      req.body
    )}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Specified currency is not available.");
  }

  let now = new Date();
  var doc = "";

  try {
    await db.runTransaction(async (t) => {
      balancesRef = db.collection("balances").doc(user);
      pendingRef = db.collection("pending_balances").doc(user);
      chistoryRef = db.collection("convert_history").doc(user);
      balances = await t.get(balancesRef);
      pending = await t.get(pendingRef);
      chistory = await t.get(chistoryRef);

      await t.set(chistoryRef, { user: user });

      var current_rate = getCurrentRate(from_currency, to_currency);
      console.log(`Current rate is: ${current_rate}`);

      if (current_rate * 1.01 < argrate || argrate < current_rate * 0.99) {
        var msg = `conversion error - rate validation failed - current rate: ${current_rate} - argrate : ${argrate}, data: ${JSON.stringify(
          req.body
        )}`;
        console.error(msg);
        sendSlackNotification(msg, "error");
        res.status(500).send("Rate validation failed.");
      }

      const data = {
        user: user,
        from_currency: from_currency,
        to_currency: to_currency,
        amount: amount,
        rate: argrate,
        datetime: now.toFormat("YYYY-MM-DD HH24:MI:SS"),
        status: "pending",
      };

      console.log(balances.data()[from_currency]);

      if (balances.data()[from_currency] >= amount) {
        var inc = {},
          dec = {};
        inc[from_currency] = firebase.firestore.FieldValue.increment(amount);
        dec[from_currency] = firebase.firestore.FieldValue.increment(-amount);
        console.log(inc);
        console.log(dec);
        t.set(balancesRef, dec, { merge: true });
        t.set(pendingRef, inc, { merge: true });
        doc = await db
          .collection("convert_history")
          .doc(user)
          .collection("history")
          .add(data);

        var msg = `conversion is now pending - data: ${JSON.stringify(
          req.body
        )}`;
        console.log(msg);
        sendSlackNotification(msg, "conversion");
      } else {
        var msg = `conversion error - insufficient balance - has ${
          balances.data()[from_currency]
        }, wants: ${amount}, data: ${JSON.stringify(req.body)}`;

        console.error(msg);
        sendSlackNotification(msg, "error");
        res.status(500).send("Balance not enough.");
        process.exit();
      }
    });
  } catch (e) {
    var msg = `conversion error - data: ${JSON.stringify(
      req.body
    )}, error: ${e}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    res.status(500).send("Internal error.");
    process.exit();
  }
  console.log("Ending");
  res.status(200).send("OK");
});

exports.conversion_batch = async (context) => {
  const db = firebase.firestore();
  try {
    let targetUsersRef = db.collection("convert_history");
    let targetUsers = await targetUsersRef.get();

    targetUsers.forEach(async (user) => {
      let targetTicketsRef = db
        .collection("convert_history")
        .doc(user.id)
        .collection("history")
        .where("status", "==", "sent");

      let targetTickets = await targetTicketsRef.get();
      targetTickets.forEach((ticket) => {
        console.log(ticket.id, user.id);
        conversion(ticket.id, user.id);
      });
    });
  } catch (e) {
    var msg = `conversion error - conversion batch failed - error: ${e}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
  }
};

const conversion = async (ticket_id, user_id) => {
  const db = firebase.firestore();
  try {
    await db.runTransaction(async (t) => {
      balancesRef = db.collection("balances").doc(user_id);
      pendingRef = db.collection("pending_balances").doc(user_id);
      ticketRef = db
        .collection("convert_history")
        .doc(user_id)
        .collection("history")
        .doc(ticket_id);
      balances = await t.get(balancesRef);
      pending = await t.get(pendingRef);
      ticket = await t.get(ticketRef);

      if (!ticket.exists) {
        var msg = `conversion error - could not find conversion ticket ${ticket_id} for user ${user_id}`;
        console.error(msg);
        sendSlackNotification(msg, "error");
        return;
      }

      const amount = new BigNumber(ticket.data().amount);
      const from_currency = ticket.data().from_currency;
      const to_currency = ticket.data().to_currency;
      const rate = new BigNumber(ticket.data().rate);
      const status = ticket.data().status;

      if (!available_currency.includes(from_currency)) {
        var msg = `conversion error - from currency ${from_currency} is not supported, ticket_id: ${ticket_id}, user: ${user_id}`;
        console.error(msg);
        sendSlackNotification(msg, "error");
        return;
      }

      if (!available_currency.includes(to_currency)) {
        var msg = `conversion error - to currency ${to_currency} is not supported, ticket_id: ${ticket_id}, user: ${user_id}`;
        console.error(msg);
        sendSlackNotification(msg, "error");
        return;
      }

      if (to_currency == "USDS") {
        to_amount =
          Math.floor(10 ** DECIMALS[to_currency] * amount * rate) /
          10 ** DECIMALS[to_currency];
      } else {
        to_amount =
          Math.floor((10 ** DECIMALS[to_currency] / rate) * amount) /
          10 ** DECIMALS[to_currency];
      }

      var pending_balance = new BigNumber(pending.data()[from_currency]);

      console.log(
        `amount: ${amount}`,
        `to_amount: ${to_amount}`,
        `from_currency:${from_currency}`,
        `to_currency: ${to_currency}`,
        `status: ${status}`,
        `pending_balance: ${pending_balance}`
      );

      if (status == "sent") {
        if (
          pending_balance.isGreaterThanOrEqualTo(amount) ||
          pending_balance
            .precision(2)
            .isGreaterThanOrEqualTo(amount.precision(2))
        ) {
          var inc = {},
            dec = {};
          inc[to_currency] = firebase.firestore.FieldValue.increment(to_amount);
          dec[from_currency] = firebase.firestore.FieldValue.increment(-amount);
          t.set(balancesRef, inc, { merge: true });
          t.set(pendingRef, dec, { merge: true });
          t.set(ticketRef, { status: "done" }, { merge: true });

          var msg = `conversion done - ticket_id: ${ticket_id} - user: ${user_id}`;
          console.log(msg);
          sendSlackNotification(msg, "conversion");
        } else {
          var msg = `conversion error - insufficient pending balance for conversion - has ${pending_balance}, wants: ${amount}, ticket_id: ${ticket_id}, user: ${user_id}`;
          console.error(msg);
          sendSlackNotification(msg, "error");
          return;
        }
      } else {
        console.warn(`status (${status}) should be 'sent'`, ticket_id, user_id);
        return;
      }
    });
  } catch (e) {
    var msg = `conversion error - error when sending conversion -ticket_id: ${ticket_id}, user: ${user_id} - error: ${e}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
    return;
  }
  return;
};

const mint_or_burn = async (amount) => {
  const { privateKey } = require("./secrets.json");
  const soteria = JSON.parse(fs.readFileSync("./Soteria_abi.json", "utf8"));
  const httpProvider = new Web3.providers.HttpProvider(ProviderUrl);
  const provider = new Web3HDWalletProvider(privateKey, httpProvider);
  const web3 = new Web3(provider);

  if (amount == 0) {
    return;
  }

  const usds = new web3.eth.Contract(soteria, UsdsContractAddr);
  try {
    if (amount > 0) {
      await usds.methods
        .mint(RebaseOwnerAddr, amount)
        .send({ from: RebaseOwnerAddr });
    } else {
      await usds.methods.burn(Math.abs(amount)).send({ from: RebaseOwnerAddr });
    }
  } catch (e) {
    var msg = `mint-burn error - ${new Date()} - Error: ${e}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
  }
};

exports.rebase = async (context) => {
  const db = firebase.firestore();
  const { privateKey } = require("./secrets.json");
  const soteria = JSON.parse(fs.readFileSync("./Soteria_abi.json", "utf8"));
  const httpProvider = new Web3.providers.HttpProvider(ProviderUrl);
  const provider = new Web3HDWalletProvider(privateKey, httpProvider);
  const web3 = new Web3(provider);
  let now = new Date();

  const usds = new web3.eth.Contract(soteria, UsdsContractAddr);
  const preTotalSupply = new BigNumber(await usds.methods.totalSupply().call());

  var supplyDelta = preTotalSupply.times(APY_PER_DAY);
  supplyDelta = supplyDelta.times(InitialFragments.div(preTotalSupply));
  supplyDelta = supplyDelta.toFixed(0);

  console.log(supplyDelta);

  var data = {
    supply: Number(Math.floor(preTotalSupply.times(APY_PER_DAY))),
    preTotalSupply: Number(preTotalSupply),
    datetime: now.toFormat("YYYY-MM-DD HH24:MI:SS"),
    timestamp: Math.floor(now / 1000),
    status: "pending",
  };

  doc = await db
    .collection("rebase_history")
    .doc(now.toFormat("YYYY-MM-DD-HH24MISS"))
    .set(data);
  var ret = usds.methods.rebase(0, supplyDelta).send({ from: RebaseOwnerAddr });
  var msg = `rebase ok - ${JSON.stringify(ret)} -${JSON.stringify(data)}`;
  console.log(msg);
  sendSlackNotification(msg, "conversion");
};

exports.distribute_interest = async (context) => {
  const db = firebase.firestore();

  try {
    let rebaseHistory = await db
      .collection("rebase_history")
      .where("status", "==", "pending")
      .get();

    await Promise.all(
      rebaseHistory.docs.map(async (reb) => {
        let targetUsersRef = db.collection("balances").where("USDS", ">", 0);
        let targetUsers = await targetUsersRef.get();
        await Promise.all(
          targetUsers.docs.map(async (user) => {
            let amount = await distribute_to_user(reb, user);
          })
        );

        let rebaseRef = db.collection("rebase_history").doc(reb.id);
        rebaseRef.set({ status: "done" }, { merge: true });

        var msg = `rebase done - interests distributed - id: ${reb.id}`;
        console.log(msg);
        sendSlackNotification(msg, "conversion");
      })
    );
  } catch (e) {
    var msg = `interest error - error while distributing interest - error: ${e}`;
    console.error(msg);
    sendSlackNotification(msg, "error");
  }
};

const distribute_to_user = async (rebaseDoc, userDoc) => {
  const db = firebase.firestore();

  const rebase = rebaseDoc.data();
  const user = userDoc.data();

  console.log(userDoc.id);

  let now = new Date();

  let rebased_amount = rebase.supply;
  let rate = rebased_amount / rebase.preTotalSupply;
  let amount = user.USDS * rate;

  const data = {
    pre_balance: user.USDS,
    amount: amount,
    datetime: now.toFormat("YYYY-MM-DD HH24:MI:SS"),
    timestamp: Math.floor(now / 1000),
  };

  await db.runTransaction(async (t) => {
    let balancesRef = await db.collection("balances").doc(userDoc.id);
    await t.set(db.collection("interest_payment_histories").doc(userDoc.id), {
      user: user,
    });
    newDoc = await db
      .collection("interest_payment_histories")
      .doc(userDoc.id)
      .collection("histories")
      .doc();
    await t.set(newDoc, data);

    let inc = {};
    inc["USDS"] = await firebase.firestore.FieldValue.increment(amount);
    await t.set(balancesRef, inc, { merge: true });

    var msg = `interest distributed to user ${
      userDoc.id
    } - data: ${JSON.stringify(data)}`;
    console.log(msg);
    sendSlackNotification(msg, "conversion");
  });

  return Promise.resolve(amount);
};

exports.rebalance_usds = async (context) => {
  const db = firebase.firestore();
  try {
    addrPoolRef = db.collection("eth_address_pool");
    var ss = await addrPoolRef.where("used", "==", true).get();
    var contract_sum = ss.docs
      .map((doc) => Number(doc.data().balance))
      .reduce((prev, current) => prev + current, 0);

    balanceRef = db.collection("balances");
    var ss2 = await balanceRef.where("USDS", ">=", 0).get();

    var db_sum = ss2.docs
      .map((doc) => Number(doc.data().USDS))
      .reduce((prev, current) => prev + current, 0);
    db_sum = Math.floor(db_sum * 10 ** DECIMALS["USDS"]);
    console.log(contract_sum);
    console.log(db_sum);
    console.log(db_sum - contract_sum);

    mint_or_burn(db_sum - contract_sum);
  } catch (e) {
    console.error(e);
  }
};

exports.update_balance_usds = async (context) => {
  const db = firebase.firestore();
  try {
    const httpProvider = new Web3.providers.HttpProvider(ProviderUrl);
    const web3 = new Web3(httpProvider);
    const soteria = JSON.parse(fs.readFileSync("./Soteria_abi.json", "utf8"));
    const now = new Date();
    const usds = new web3.eth.Contract(soteria, UsdsContractAddr);

    addrPoolRef = db.collection("eth_address_pool");
    ss = await addrPoolRef
      .where("used", "==", true)
      .orderBy("updatedAt", "asc")
      .limit(20)
      .get();
    ss.forEach(async (doc) => {
      console.log(doc.data().address);
      const userBalance = await usds.methods
        .balanceOf(doc.data().address)
        .call();
      var data = {
        balance: userBalance,
        updatedAt: now.toFormat("YYYY-MM-DD-HH24MISS"),
      };
      addrPoolRef.doc(doc.id).set(data, { merge: true });
    });
  } catch (e) {
    console.error(e);
  }
};

exports.usds_watcher = async (context) => {
  try {
    const httpProvider = new Web3.providers.HttpProvider(ProviderUrl);
    const web3 = new Web3(httpProvider);
    const soteria = JSON.parse(fs.readFileSync("./Soteria_abi.json", "utf8"));

    const usds = new web3.eth.Contract(soteria, UsdsContractAddr);
    const db = firebase.firestore();

    var lastBlockNumber = await db
      .collection("usds_transactions")
      .orderBy("blockNumber", "desc")
      .limit(1);

    // Check if null/undefined or NAN
    if (!lastBlockNumber || isNaN(lastBlockNumber)) {
      lastBlockNumber = 12643520;
    }
    console.log(`Last block number: ${lastBlockNumber}`);

    var events = await usds.getPastEvents("Transfer", {
      fromBlock: Number(lastBlockNumber),
      toBlock: "latest",
    });

    for (var i = 0; i < events.length; i++) {
      var tx = events[i];
      var txhash = tx.transactionHash;
      var from = tx.returnValues.from;
      var to = tx.returnValues.to;
      var amount = Number(tx.returnValues.value) / 10 ** DECIMALS["USDS"];

      var blk = await web3.eth.getBlock(tx.blockNumber);
      var ts = blk.timestamp;

      addDoc(from, to, amount, ts, txhash, tx.blockNumber);
    }
  } catch (e) {
    console.error(e);
  }
};

exports.rebase_watcher = async (context) => {
  try {
    const db = firebase.firestore();
    const httpProvider = new Web3.providers.HttpProvider(ProviderUrl);
    const web3 = new Web3(httpProvider);
    const soteria = JSON.parse(fs.readFileSync("./Soteria_abi.json", "utf8"));

    const usds = new web3.eth.Contract(soteria, UsdsContractAddr);
    var lastBlockNumber = await db
      .collection("rebase_events")
      .orderBy("blockNumber", "desc")
      .limit(1);

    console.log(`Last block number: ${lastBlockNumber}`);

    var events = await usds.getPastEvents("LogRebase", {
      fromBlock: Number(lastBlockNumber),
      toBlock: "latest",
    });

    for (var i = 0; i < events.length; i++) {
      var tx = events[i];
      var txhash = tx.transactionHash;
      var postTotalSupply = tx.returnValues.totalSupply;

      var blk = await web3.eth.getBlock(tx.blockNumber);
      var ts = blk.timestamp;
      var now = new Date(ts * 1000);

      var data = {
        postTotalSupply: Number(postTotalSupply),
        datetime: now.toFormat("YYYY-MM-DD HH24:MI:SS"),
        timestamp: ts,
        txid: txhash,
        blockNumber: tx.blockNumber,
      };

      doc = await db
        .collection("rebase_events")
        .doc(now.toFormat("YYYY-MM-DD-HH24MISS"));
      if (!doc.exists) {
        doc.set(data);
      }
    }
  } catch (e) {
    console.error(e);
  }
};

async function addDoc(from, to, amount, timestamp, txhash, blockNumber) {
  try {
    const db = firebase.firestore();
    saved = await saveTx(from, to, amount, timestamp, txhash, blockNumber);
    if (!saved) {
      return;
    }

    let addrRef = db.collection("eth_accounts");
    let queryRef = addrRef
      .where("address", "==", to)
      .get()
      .then((snapshot) => {
        if (snapshot.empty) {
          console.log("No matching documents.");
          return;
        }
        snapshot.forEach((doc) => {
          db.collection("balances")
            .doc(doc.id)
            .update({ USDS: firebase.firestore.FieldValue.increment(amount) })
            .then(function () {
              console.log(
                "" + amount + " USDS is added to " + doc.id + " (address:" + to
              );
            });
        });
      });
  } catch (e) {
    console.error(e);
  }
}

async function saveTx(from, to, amount, timestamp, txhash, blockNumber) {
  const db = firebase.firestore();
  try {
    let txRef = await db.collection("usds_transactions").doc(txhash).get();
    if (!txRef.exists) {
      var save = await db.collection("usds_transactions").doc(txhash).create({
        from: from,
        to: to,
        amount: amount,
        timestamp: timestamp,
        txhash: txhash,
        blockNumber: blockNumber,
      });
      console.log("New tx stored. txhash=" + txhash);
      return true;
    } else {
      console.log("Duplicated tx. txhash=" + txhash);
    }
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function getCurrentRate(from_currency, to_currency) {
  if (
    stable_coins.includes(from_currency) ||
    stable_coins.includes(to_currency)
  ) {
    return 1;
  }

  var currency_pair =
    from_currency == "USDS" ? `${to_currency}-USD` : `${from_currency}-USD`;

  var current_rate;

  const db = firebase.firestore();
  priceRef = db
    .collection("price_histories")
    .where("currency_pair", "==", currency_pair);
  ss = await priceRef.orderBy("timestamp", "desc").limit(1).get();
  ss.forEach((doc) => {
    current_rate = doc.data().rate;
  });

  return current_rate;
}
