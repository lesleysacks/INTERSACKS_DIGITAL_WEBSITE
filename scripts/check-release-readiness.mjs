/*
 * Release gate for the owner. Fails while the privacy notice still contains
 * "[OWNER TO CONFIRM: ...]" placeholders, or while the contact form's notice
 * version and the privacy notice date disagree. Run before merging Release 1:
 *   npm run check:release
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(root + file, 'utf8');
const problems = [];

const privacy = read('privacy.html');
const placeholders = privacy.match(/\[OWNER TO CONFIRM: [^\]]+\]/g) || [];
for (const item of placeholders) problems.push(`privacy.html still contains ${item}`);

const version = /name="privacyNotice" value="(\d{4})-(\d{2})-(\d{2})"/.exec(read('contact.html'));
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
if (!version) problems.push('contact.html has no privacyNotice version');
else if (!privacy.includes(`Updated ${Number(version[3])} ${months[Number(version[2]) - 1]} ${version[1]}.`)) {
  problems.push('The privacyNotice version on contact.html does not match the "Updated" date on privacy.html');
}

if (problems.length) {
  console.error(`Release 1 is not ready to publish:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Release readiness checks passed.');
