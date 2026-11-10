import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const siteUrl = "https://nova-space.pp.ua";
const googleAdsId = "AW-18188518715";
const googleTagManagerUrl = `https://www.googletagmanager.com/gtag/js?id=${googleAdsId}`;
const googleAdsConversionLabels = [
  "AW-18188518715/UQDSCOW7j8McELuK--BD",
  "AW-18188518715/AcDdCOi7j8McELuK--BD",
  "AW-18188518715/l25FCPSricMcELuK--BD"
];
const distDir = resolve("dist");
const expectedUrlCount = 15;
const indexNowKey = "04329b1562807a21488f46f4ce417551";
const indexNowKeyFile = `${indexNowKey}.txt`;
const publicPages = [
  "/",
  "/brovary/",
  "/vr/",
  "/studio/",
  "/booking/",
  "/vr-klub-brovary/",
  "/den-narodzhennya-vr-brovary/",
  "/korporatyv-vr-brovary/",
  "/vr-dlya-ditey-brovary/",
  "/ps5-brovary/",
  "/fotostudiya-brovary/",
  "/orenda-fotostudiyi-brovary/",
  "/fotosesiya-brovary/",
  "/simeyna-fotosesiya-brovary/",
  "/kontent-zyomka-brovary/"
];
const adminPages = ["/admin/", "/admin/bookings/", "/admin/vr-games/"];
const faviconSets = {
  home: {
    ico: "/favicon.ico",
    png48: "/favicon-48x48.png",
    png192: "/favicon-192x192.png",
    png512: "favicon-512x512.png",
    apple: "/apple-touch-icon.png",
    svg: "/favicon.svg",
    label: "N.H"
  },
  vr: {
    ico: "/favicon-vr.ico",
    png48: "/favicon-vr-48x48.png",
    png192: "/favicon-vr-192x192.png",
    png512: "favicon-vr-512x512.png",
    apple: "/apple-touch-icon-vr.png",
    svg: "/favicon-vr.svg",
    label: "N.VR"
  },
  studio: {
    ico: "/favicon-studio.ico",
    png48: "/favicon-studio-48x48.png",
    png192: "/favicon-studio-192x192.png",
    png512: "favicon-studio-512x512.png",
    apple: "/apple-touch-icon-studio.png",
    svg: "/favicon-studio.svg",
    label: "N.PS"
  }
};
const vrFaviconPages = new Set([
  "/vr/",
  "/vr-klub-brovary/",
  "/den-narodzhennya-vr-brovary/",
  "/korporatyv-vr-brovary/",
  "/vr-dlya-ditey-brovary/",
  "/ps5-brovary/"
]);
const studioFaviconPages = new Set([
  "/studio/",
  "/fotostudiya-brovary/",
  "/orenda-fotostudiyi-brovary/",
  "/fotosesiya-brovary/",
  "/simeyna-fotosesiya-brovary/",
  "/kontent-zyomka-brovary/"
]);

const requiredSchemaTypes = {
  "/": ["Organization", "WebSite", "CollectionPage"],
  "/brovary/": ["Organization", "WebSite", "LocalBusiness", "CollectionPage", "BreadcrumbList"],
  "/vr/": ["Organization", "WebSite", "LocalBusiness", "WebPage", "ItemList", "BreadcrumbList", "FAQPage"],
  "/studio/": ["Organization", "WebSite", "LocalBusiness", "WebPage", "BreadcrumbList"],
  "/booking/": ["Organization", "WebSite", "WebPage", "BreadcrumbList"]
};

const landingSchemaTypes = ["Organization", "WebSite", "LocalBusiness", "WebPage", "Service", "BreadcrumbList", "FAQPage"];

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const pageFilePath = (path) => {
  if (path === "/") return join(distDir, "index.html");
  return join(distDir, path.replace(/^\/|\/$/g, ""), "index.html");
};

const readPage = async (path) => {
  const file = pageFilePath(path);
  assert(existsSync(file), `Missing generated page for ${path}: ${file}`);
  return readFile(file, "utf8");
};

const absoluteUrl = (path) => new URL(path, siteUrl).toString();

const matchAttribute = (html, selector) => {
  const match = html.match(selector);
  return match ? match[1] : "";
};

const parseSchemas = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((match) => {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [parsed];
  });

const getTypes = (schemas) => schemas.map((schema) => schema["@type"]);

const findSchemas = (schemas, type) => schemas.filter((schema) => schema["@type"] === type);

const assertTypes = (path, schemas, expectedTypes) => {
  const types = getTypes(schemas);
  for (const type of expectedTypes) {
    assert(types.includes(type), `${path} is missing ${type} schema`);
  }
};

const assertBreadcrumbStartsAtHome = (path, schemas) => {
  const breadcrumb = findSchemas(schemas, "BreadcrumbList")[0];
  assert(breadcrumb, `${path} is missing BreadcrumbList schema`);
  const items = breadcrumb.itemListElement?.map((item) => item.item) || [];
  assert(items[0] === `${siteUrl}/`, `${path} breadcrumb does not start at the homepage`);
};

const assertLocalBusinessesHaveGeo = (path, schemas) => {
  for (const business of findSchemas(schemas, "LocalBusiness")) {
    assert(business.geo?.latitude && business.geo?.longitude, `${path} LocalBusiness is missing geo coordinates`);
    assert(business.address?.postalCode === "07401", `${path} LocalBusiness is missing the Brovary postal code`);
    assert(business.telephone, `${path} LocalBusiness is missing telephone`);
    assert(business.hasMap?.startsWith("https://www.google.com/maps/"), `${path} LocalBusiness is missing Google Maps link`);
    assert(business.openingHoursSpecification?.length, `${path} LocalBusiness is missing opening hours`);
    assert(business.additionalType?.startsWith("https://schema.org/"), `${path} LocalBusiness is missing additionalType`);
    assert(business.knowsAbout?.length >= 3, `${path} LocalBusiness is missing local knowsAbout topics`);
  }
};

const assertLocalBusinessesHaveMedia = (path, schemas) => {
  for (const business of findSchemas(schemas, "LocalBusiness")) {
    const images = Array.isArray(business.image) ? business.image : [business.image].filter(Boolean);
    const photos = Array.isArray(business.photo) ? business.photo : [business.photo].filter(Boolean);
    const amenities = Array.isArray(business.amenityFeature) ? business.amenityFeature : [];

    assert(images.length >= 2, `${path} LocalBusiness should expose multiple images`);
    assert(photos.length >= 2, `${path} LocalBusiness should expose multiple photos`);
    assert(amenities.length >= 2, `${path} LocalBusiness should expose amenityFeature entries`);
  }
};

const assertItemListsHaveLocalUrls = (path, schemas) => {
  for (const itemList of findSchemas(schemas, "ItemList")) {
    const items = itemList.itemListElement || [];
    assert(items.length >= 3, `${path} ItemList should expose at least three local service URLs`);

    for (const item of items) {
      assert(item.url?.startsWith(siteUrl), `${path} ItemList contains a non-local URL: ${item.url}`);
    }
  }
};

const readSitemapUrls = async () => {
  const sitemap = await readFile(join(distDir, "sitemap.xml"), "utf8");
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  const pageUrls = urls.filter((url) => !url.match(/\.(webp|png|jpg|jpeg|svg)$/i));
  return { sitemap, pageUrls };
};

const readBasicSitemapUrls = async () => {
  const sitemap = await readFile(join(distDir, "sitemap-basic.xml"), "utf8");
  const pageUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  return { sitemap, pageUrls };
};

const auditRobots = async () => {
  const robots = await readFile(join(distDir, "robots.txt"), "utf8");
  assert(robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`), "robots.txt is missing the sitemap directive");
  assert(robots.includes(`Sitemap: ${siteUrl}/sitemap-basic.xml`), "robots.txt is missing the basic sitemap directive");
};

const auditNginx = async () => {
  const nginx = await readFile(resolve("nginx.conf"), "utf8");
  assert(nginx.includes("location ^~ /admin"), "nginx.conf is missing an /admin location");
  assert(nginx.includes('X-Robots-Tag "noindex, nofollow, noarchive" always'), "nginx.conf is missing admin X-Robots-Tag");
  assert(nginx.includes("location = /robots.txt"), "nginx.conf is missing an exact robots.txt location");
  assert(nginx.includes("location = /sitemap.xml"), "nginx.conf is missing an exact sitemap.xml location");
  assert(nginx.includes("location = /sitemap-basic.xml"), "nginx.conf is missing an exact sitemap-basic.xml location");
  assert(nginx.includes("location = /site.webmanifest"), "nginx.conf is missing an exact site.webmanifest location");
  assert(nginx.includes("application/manifest+json"), "nginx.conf should serve site.webmanifest as application/manifest+json");
};

const auditIndexNow = async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const publicKey = (await readFile(resolve("public", indexNowKeyFile), "utf8")).trim();
  const distKey = (await readFile(join(distDir, indexNowKeyFile), "utf8")).trim();
  const submitScript = await readFile(resolve("scripts", "submit-indexnow.mjs"), "utf8");

  assert(publicKey === indexNowKey, "Public IndexNow key file content does not match the configured key");
  assert(distKey === indexNowKey, "Built IndexNow key file content does not match the configured key");
  assert(packageJson.scripts?.["indexnow:submit"], "package.json is missing indexnow:submit");
  assert(packageJson.scripts?.["indexnow:dry-run"], "package.json is missing indexnow:dry-run");
  assert(submitScript.includes("api.indexnow.org/indexnow"), "submit-indexnow.mjs is missing the IndexNow endpoint");
  assert(submitScript.includes(indexNowKey), "submit-indexnow.mjs is missing the configured IndexNow key");
};

const readBinary = (path) => readFile(path);

const parsePngSize = (buffer) => {
  const signature = buffer.subarray(0, 8).toString("hex");
  assert(signature === "89504e470d0a1a0a", "Favicon PNG has an invalid signature");

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
};

const assertPngSize = async (filename, expectedSize) => {
  const buffer = await readBinary(join(distDir, filename));
  const { width, height } = parsePngSize(buffer);
  assert(width === expectedSize && height === expectedSize, `${filename} must be ${expectedSize}x${expectedSize}, got ${width}x${height}`);
};

const assertIcoFile = async (filename) => {
  const icon = await readBinary(join(distDir, filename));
  assert(icon.readUInt16LE(0) === 0, `${filename} has an invalid reserved field`);
  assert(icon.readUInt16LE(2) === 1, `${filename} must be an icon file`);
  const entryCount = icon.readUInt16LE(4);
  assert(entryCount >= 3, `${filename} should include multiple icon sizes`);

  for (let index = 0; index < entryCount; index += 1) {
    const offset = 6 + index * 16;
    const bytes = icon.readUInt32LE(offset + 8);
    const imageOffset = icon.readUInt32LE(offset + 12);
    assert(bytes > 100, `${filename} entry ${index + 1} is unexpectedly small`);
    assert(imageOffset + bytes <= icon.length, `${filename} entry ${index + 1} points outside the file`);
  }
};

const faviconFilename = (path) => path.replace(/^\//, "");

const auditFavicons = async () => {
  for (const [name, set] of Object.entries(faviconSets)) {
    await assertIcoFile(faviconFilename(set.ico));
    await assertPngSize(faviconFilename(set.png48), 48);
    await assertPngSize(faviconFilename(set.png192), 192);
    await assertPngSize(set.png512, 512);
    await assertPngSize(faviconFilename(set.apple), 180);

    const faviconSvg = await readFile(join(distDir, faviconFilename(set.svg)), "utf8");
    assert(faviconSvg.includes('viewBox="0 0 512 512"'), `${name} favicon.svg must be square`);
    assert(faviconSvg.includes(set.label), `${name} favicon.svg is missing ${set.label}`);
  }

  const manifest = JSON.parse(await readFile(join(distDir, "site.webmanifest"), "utf8"));
  const iconSrcs = manifest.icons?.map((icon) => icon.src) || [];
  assert(iconSrcs.includes("/favicon-192x192.png"), "site.webmanifest is missing the 192px icon");
  assert(iconSrcs.includes("/favicon-512x512.png"), "site.webmanifest is missing the 512px icon");
};

const expectedFaviconSet = (path) => {
  if (vrFaviconPages.has(path)) return faviconSets.vr;
  if (studioFaviconPages.has(path)) return faviconSets.studio;
  return faviconSets.home;
};

const auditSitemap = async () => {
  const { sitemap, pageUrls } = await readSitemapUrls();
  const { sitemap: basicSitemap, pageUrls: basicPageUrls } = await readBasicSitemapUrls();
  assert(pageUrls.length === expectedUrlCount, `Expected ${expectedUrlCount} sitemap page URLs, found ${pageUrls.length}`);
  assert(basicPageUrls.length === expectedUrlCount, `Expected ${expectedUrlCount} basic sitemap page URLs, found ${basicPageUrls.length}`);
  assert(new Set(pageUrls).size === pageUrls.length, "Sitemap has duplicate page URLs");
  assert(new Set(basicPageUrls).size === basicPageUrls.length, "Basic sitemap has duplicate page URLs");
  assert(!sitemap.includes("/admin/"), "Sitemap must not include admin pages");
  assert(!basicSitemap.includes("/admin/"), "Basic sitemap must not include admin pages");

  for (const path of publicPages) {
    assert(pageUrls.includes(absoluteUrl(path)), `Sitemap is missing ${path}`);
    assert(basicPageUrls.includes(absoluteUrl(path)), `Basic sitemap is missing ${path}`);
  }
};

const auditAdminPage = async (path) => {
  const html = await readPage(path);
  const canonical = matchAttribute(html, /<link rel="canonical" href="([^"]+)"/);
  const robots = matchAttribute(html, /<meta name="robots" content="([^"]+)"/);

  assert(canonical === absoluteUrl(path), `${path} canonical mismatch: ${canonical}`);
  assert(robots === "noindex,nofollow", `${path} robots meta should be noindex,nofollow`);
  assert(!html.includes(googleAdsId), `${path} should not load the Google Ads tag`);
  assert(!html.includes("googletagmanager.com"), `${path} should not load Google Tag Manager`);
  assert(!html.includes("FAQPage"), `${path} should not expose public FAQ schema`);
  assert(!html.includes("LocalBusiness"), `${path} should not expose public LocalBusiness schema`);
};

const auditPage = async (path) => {
  const html = await readPage(path);
  const canonical = matchAttribute(html, /<link rel="canonical" href="([^"]+)"/);
  const description = matchAttribute(html, /<meta name="description" content="([^"]+)"/);
  const robots = matchAttribute(html, /<meta name="robots" content="([^"]+)"/);
  const schemas = parseSchemas(html);

  assert(canonical === absoluteUrl(path), `${path} canonical mismatch: ${canonical}`);
  assert(description.length >= 80, `${path} meta description is too short`);
  assert(robots === "index,follow", `${path} robots meta should be index,follow`);
  assert(html.includes(googleAdsId), `${path} is missing the Google Ads tag`);
  assert(html.includes(googleTagManagerUrl), `${path} is missing the Google Tag Manager script URL`);
  for (const label of googleAdsConversionLabels) {
    assert(html.includes(label), `${path} is missing Google Ads conversion label ${label}`);
  }
  assert(html.includes("event_callback"), `${path} is missing Google Ads click callback handling`);
  assert(html.includes(`<link rel="alternate" hreflang="uk-UA" href="${canonical}"`), `${path} is missing uk-UA hreflang`);
  const faviconSet = expectedFaviconSet(path);
  assert(html.includes(`href="${faviconSet.ico}"`), `${path} is missing ${faviconSet.ico}`);
  assert(html.includes(`href="${faviconSet.png48}"`), `${path} is missing ${faviconSet.png48}`);
  assert(html.includes(`href="${faviconSet.png192}"`), `${path} is missing ${faviconSet.png192}`);
  assert(html.includes(`href="${faviconSet.svg}"`), `${path} is missing ${faviconSet.svg}`);
  assert(html.includes(`href="${faviconSet.apple}"`), `${path} is missing ${faviconSet.apple}`);
  assert(html.includes(`href="/site.webmanifest"`), `${path} is missing web manifest`);
  assert(!html.includes(`<link rel="icon" href="/vr/nova-space-logo`), `${path} still uses the wide Nova Space logo as a favicon`);
  assert(html.includes(`<meta name="theme-color" content="#050711"`), `${path} is missing theme-color`);
  assert(html.includes(`<meta property="og:image:alt"`), `${path} is missing og:image:alt`);
  assert(html.includes(`<meta name="geo.position" content="50.49937;30.77804"`), `${path} is missing geo.position`);
  assert(html.includes(`<meta property="place:location:latitude" content="50.49937"`), `${path} is missing place latitude`);
  assert(html.includes(`<meta property="business:contact_data:street_address" content="вул. Ярослава Мудрого, 28"`), `${path} is missing business street address`);
  assert(html.includes(`<meta property="business:contact_data:postal_code" content="07401"`), `${path} is missing business postal code`);
  assert(!html.includes("Точну адресу можна додати"), `${path} contains old placeholder address FAQ text`);
  assert((html.match(/id="contacts"/g) || []).length <= 1, `${path} has duplicate contacts ids`);

  const expected = requiredSchemaTypes[path] || landingSchemaTypes;
  assertTypes(path, schemas, expected);
  assertLocalBusinessesHaveGeo(path, schemas);
  assertLocalBusinessesHaveMedia(path, schemas);
  if (expected.includes("ItemList")) assertItemListsHaveLocalUrls(path, schemas);

  if (path !== "/") assertBreadcrumbStartsAtHome(path, schemas);
  if (path.includes("fotostudiya")) assert(!html.includes('href="/vr/#sessions"'), `${path} studio CTA still links to VR sessions`);
  if (path === "/studio/") {
    assert(html.includes('href="#booking"'), `${path} should keep booking CTAs on the studio page`);
    assert(!html.includes("/booking/?service=studio-rent"), `${path} should not send studio booking CTAs to the global booking page`);
    assert(html.includes("/studio/studio-hero-floral-1066.webp"), `${path} should use the optimized floral studio hero image`);
    assert(html.includes("/studio/studio-hero-floral-640.webp 640w"), `${path} should expose the mobile studio hero srcset`);
    assert(html.includes("/studio/studio-cozy-zone-bright-900.webp"), `${path} should use the brighter second studio tile image`);
    assert(!html.includes("/studio/studio-hero.png"), `${path} should not reference the old heavy studio hero PNG`);
    assert(!html.includes("10:00-21:00"), `${path} should not show the obsolete opening hours`);
  }
  if (path === "/vr/") {
    assert(html.includes('id="booking"') && html.includes("data-booking-widget"), `${path} is missing the local VR booking widget`);
    assert(html.includes("?service=vr-60#booking"), `${path} should keep VR format booking links on the VR page`);
    assert(!html.includes('value="studio-rent"'), `${path} should not render studio booking options`);
    assert(!html.includes("PS5 окремо"), `${path} should not show the secondary PS5 CTA in the events block`);
  }

  return {
    path,
    schemaTypes: getTypes(schemas)
  };
};

await auditRobots();
await auditNginx();
await auditIndexNow();
await auditFavicons();
await auditSitemap();
const reports = [];

for (const path of publicPages) {
  reports.push(await auditPage(path));
}

for (const path of adminPages) {
  await auditAdminPage(path);
}

console.log(`SEO audit passed for ${reports.length} public pages, ${adminPages.length} admin pages and ${expectedUrlCount} sitemap URLs.`);
