// Standalone diagnostic - run with: node check-connection.js
// Tests whether the SRV DNS lookup mongodb+srv:// depends on works, using
// several different DNS resolvers, to pin down exactly where it's blocked.
require('dotenv').config();
const dns = require('dns');

const uri = process.env.MONGO_URI || '';
const match = uri.match(/@([^/?]+)/);
const host = match ? match[1] : null;

if (!host) {
  console.error('Could not find a host in MONGO_URI - check your .env file.');
  process.exit(1);
}

function testResolver(label, servers) {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver();
    if (servers) resolver.setServers(servers);
    resolver.resolveSrv(`_mongodb._tcp.${host}`, (err, addresses) => {
      if (err) {
        console.log(`[${label}] FAILED - ${err.code}: ${err.message}`);
      } else {
        console.log(`[${label}] OK - found ${addresses.length} server(s):`);
        addresses.forEach((a) => console.log(`    ${a.name}:${a.port}`));
      }
      resolve();
    });
  });
}

(async () => {
  console.log(`Testing SRV DNS lookup for _mongodb._tcp.${host}\n`);
  await testResolver('system default DNS', null);
  await testResolver('Google DNS (8.8.8.8)', ['8.8.8.8']);
  await testResolver('Cloudflare DNS (1.1.1.1)', ['1.1.1.1']);
  console.log(
    '\nIf ALL three failed, DNS itself (not just SRV records) is likely being ' +
      'blocked outbound on this network - use the standard (non-SRV) Atlas ' +
      'connection string instead. If only "system default" failed, the fix ' +
      'already applied in db.js (forcing 8.8.8.8/1.1.1.1) should resolve it.'
  );
})();
