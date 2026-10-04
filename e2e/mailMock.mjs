// Loaded into the API process. Catches the request that would go to the email
// provider and appends it to a file instead.
import fs from "node:fs";

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("https://api.brevo.com/")) {
    fs.appendFileSync(
      process.env.MAIL_LOG,
      `${JSON.stringify(JSON.parse(options.body))}\n`,
    );
    return new Response("{}", { status: 201 });
  }
  return realFetch(url, options);
};
