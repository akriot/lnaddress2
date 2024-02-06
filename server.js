require("dotenv").config(); // Load environment variables

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { bech32 } = require("bech32");
const axios = require("axios");
const cors = require("cors");
const app = express();
const port = 3002;

// Body parser middleware to parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors());
app.use(express.static("./public"));
// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Function to check if a string is a valid LNURL
const isLnurl = (str) => {
  try {
    let p = str.split(/[:=]/);
    str = p.length === 2 ? p[1] : str;
    let d = bech32.decode(str, 10000);
    let b = bech32.fromWords(d.words);
    return Buffer.from(b).toString();
  } catch (e) {
    return false;
  }
};

// Function to decode LNURL
const decodeLnurl = (lnurl) => {
  let p = lnurl.split(/[:=]/);
  lnurl = p.length === 2 ? p[1] : lnurl;
  let d = bech32.decode(lnurl, 10000);
  let b = bech32.fromWords(d.words);
  return Buffer.from(b).toString();
};

// Endpoint to create a new LNURL entry
app.post("/create-lnurl", async (req, res) => {
  let { alias, lnurl } = req.body;
  alias = alias.toLowerCase();
  // Check if lnurl is valid
  if (!isLnurl(lnurl)) {
    return res.status(400).json({ status: "ERROR", message: "Invalid LNURL" });
  }

  // Insert the new entry into Supabase
  const { data, error } = await supabase.from("lnurls").insert([{ alias, lnurl }]).single();

  if (error) {
    return res.status(500).json({ status: "ERROR", message: "Error saving to database", error: error.message });
  }

  res.status(201).json({ status: "OK", message: "LNURL created successfully", data });
});

app.put("/update-payment-status/:alias", async (req, res) => {
  const requestedAlias = req.params.alias;
  const { error } = await supabase.from("lnurls").update({ payment_status: true }).eq("alias", requestedAlias);
  if (error) {
    return res.status(500).json({ status: "ERROR", message: "Error! while processing payment" });
  }
  return res.status(204).json({ status: "OK" });
});

// Dynamic route to handle any alias
app.get("/.well-known/lnurlp/:alias", async (req, res) => {
  const requestedAlias = req.params.alias;

  // Fetch the LNURL from Supabase
  const { data, error } = await supabase.from("lnurls").select("lnurl, payment_status").eq("alias", requestedAlias).single();

  if (error || !data) {
    return res.status(400).json({ status: "ERROR", message: "Alias not found" });
  }

  if (data.payment_status === false) {
    return res.status(400).json({ status: "ERROR", message: "You haven't completed your payment" });
  }

  // Decode and fetch LNURL data
  const decodedLnurl = decodeLnurl(data.lnurl);
  try {
    const response = await axios.get(decodedLnurl);
    const lnurlResponse = response.data;

    const formattedResponse = {
      status: "OK",
      tag: lnurlResponse.tag || "payRequest",
      commentAllowed: lnurlResponse.commentAllowed || 255,
      callback: lnurlResponse.callback,
      metadata: lnurlResponse.metadata,
      minSendable: lnurlResponse.minSendable,
      maxSendable: lnurlResponse.maxSendable,
      payerData: {
        name: { mandatory: false },
        email: { mandatory: false },
        pubkey: { mandatory: false },
      },
      nostrPubkey: "79f00d3f5a19ec806189fcab03c1be4ff81d18ee4f653c88fac41fe03570f432",
      allowsNostr: true,
    };

    res.json(formattedResponse);
  } catch (error) {
    res.status(500).json({ status: "ERROR", message: "Error fetching LNURL data", error: error.message });
  }
});

app.post("/create-order", async (req, res) => {
  try {
    const url = "https://api.getalby.com/invoices";
    const headers = {
      Authorization: `Bearer ${process.env.ALBY_CREATE_ORDER_AUTH}`,
      "Content-Type": "application/json",
    };
    const data = {
      amount: 1, // Amount in satoshis
      description: "Service Payment",
    };
    fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((responseData) => {
        return res.status(200).json({ status: "OK", ...responseData });
      })
      .catch((error) => {
        return res.status(500).json({ status: "ERROR", message: "Something went wrong" });
      });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Something went wrong" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
