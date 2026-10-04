// Loaded into the API process. Catches the request that would go to the email
// provider and appends it to a file instead. It also stands in for Razorpay's
// order API, so the upgrade flow can be tried without the real service.
import fs from "node:fs";

const realFetch = globalThis.fetch;
let orders = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("https://api.brevo.com/")) {
    fs.appendFileSync(
      process.env.MAIL_LOG,
      `${JSON.stringify(JSON.parse(options.body))}\n`,
    );
    return new Response("{}", { status: 201 });
  }
  if (String(url) === "https://api.razorpay.com/v1/orders") {
    const { amount } = JSON.parse(options.body);
    orders += 1;
    return new Response(
      JSON.stringify({ id: `order_e2e_${orders}`, amount, currency: "INR" }),
      { status: 200 },
    );
  }
  return realFetch(url, options);
};
