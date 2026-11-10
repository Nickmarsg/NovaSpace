import { bookingServices } from "./bookingServices.js";
import { studioServices } from "./studio.js";

export const siteUrl = "https://nova-space.pp.ua";
export const phone = "+380660097630";
export const bookingUrl = `${siteUrl}/booking/`;
export const mapsUrl =
  "https://www.google.com/maps/search/?api=1&query=%D0%BC.+%D0%91%D1%80%D0%BE%D0%B2%D0%B0%D1%80%D0%B8,+%D0%B2%D1%83%D0%BB.+%D0%AF%D1%80%D0%BE%D1%81%D0%BB%D0%B0%D0%B2%D0%B0+%D0%9C%D1%83%D0%B4%D1%80%D0%BE%D0%B3%D0%BE,+28";
export const studioInstagramUrl = "https://www.instagram.com/nova_photostudio_/";
export const vrInstagramUrl = "https://www.instagram.com/novaspace_vr/";
export const vrTikTokUrl = "https://www.tiktok.com/@www.tiktok.novaspace_vr";

export const address = {
  "@type": "PostalAddress",
  streetAddress: "вул. Ярослава Мудрого, 28",
  addressLocality: "Бровари",
  addressRegion: "Київська область",
  postalCode: "07401",
  addressCountry: "UA"
};

export const geo = {
  "@type": "GeoCoordinates",
  latitude: 50.49937,
  longitude: 30.77804
};

const week = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
];

const actionPlatforms = [
  "http://schema.org/DesktopWebPlatform",
  "http://schema.org/MobileWebPlatform"
];

const makeContactPoint = (areaServed = "UA") => ({
  "@type": "ContactPoint",
  telephone: phone,
  contactType: "customer service",
  areaServed,
  availableLanguage: ["uk", "ru"]
});

const makeReserveAction = (name) => ({
  "@type": "ReserveAction",
  name,
  target: {
    "@type": "EntryPoint",
    urlTemplate: bookingUrl,
    inLanguage: "uk-UA",
    actionPlatform: actionPlatforms
  }
});

const extractPrice = (value) => {
  const match = String(value).match(/\d+/);
  return match ? match[0] : undefined;
};

const cityServed = {
  "@type": "City",
  name: "Бровари"
};

const imageObject = (path, name) => ({
  "@type": "ImageObject",
  url: new URL(path, siteUrl).toString(),
  name
});

const makeAmenity = (name) => ({
  "@type": "LocationFeatureSpecification",
  name,
  value: true
});

const vrImages = [
  imageObject("/vr/nova-space-logo.webp", "Логотип Nova Space"),
  imageObject("/vr/nova-vr-about-players.webp", "Гравці у NOVA VR у Броварах"),
  imageObject("/vr/nova-vr-about-ps5.webp", "PS5 зона у NOVA VR"),
  imageObject("/vr/nova-vr-about-duo.webp", "VR кімната для двох")
];

const studioImages = [
  imageObject("/studio/studio-hero-floral-1066.webp", "Nova PhotoStudio у Броварах"),
  imageObject("/studio/studio-paper-backdrops.jpg", "Паперові фони Nova PhotoStudio"),
  imageObject("/studio/studio-cozy-zone-bright-900.webp", "Затишна зона Nova PhotoStudio"),
  imageObject("/studio/studio-wood-backdrop.jpg", "Фактурна зона Nova PhotoStudio")
];

const makeBookingOffer = (service, providerId) => ({
  "@type": "Offer",
  "@id": `${bookingUrl}#offer-${service.slug}`,
  name: service.name,
  url: bookingUrl,
  price: extractPrice(service.price_day),
  priceCurrency: "UAH",
  availability: "https://schema.org/InStock",
  description: `${service.price_day}${
    service.price_evening !== service.price_day ? `, вечір: ${service.price_evening}` : ""
  }. ${service.price_note}`,
  eligibleQuantity: {
    "@type": "QuantitativeValue",
    minValue: service.min_people,
    maxValue: service.max_people
  },
  itemOffered: {
    "@type": "Service",
    name: service.name,
    serviceType: service.area,
    provider: {
      "@id": providerId
    },
    areaServed: cityServed
  }
});

const makeTextOffer = ({ id, name, price, description, providerId, url = bookingUrl }) => ({
  "@type": "Offer",
  "@id": `${url}#offer-${id}`,
  name,
  url,
  price: extractPrice(price),
  priceCurrency: "UAH",
  availability: "https://schema.org/InStock",
  description,
  itemOffered: {
    "@type": "Service",
    name,
    provider: {
      "@id": providerId
    },
    areaServed: cityServed
  }
});

const makeOfferCatalog = (name, offers) => ({
  "@type": "OfferCatalog",
  name,
  itemListElement: offers
});

const absoluteSiteUrl = (path = "/") => new URL(path, siteUrl).toString();

export const makeBreadcrumbSchema = (items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: item.url?.startsWith("http") ? item.url : absoluteSiteUrl(item.url || "/")
  }))
});

export const makeItemListSchema = ({ id, name, items }) => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  "@id": id?.startsWith("http") ? id : absoluteSiteUrl(id || "/#item-list"),
  name,
  itemListElement: items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    url: item.url?.startsWith("http") ? item.url : absoluteSiteUrl(item.url || "/")
  }))
});

/**
 * @param {{
 *   path: string;
 *   name: string;
 *   description: string;
 *   type?: string;
 *   about?: unknown;
 *   image?: string;
 *   mainEntity?: unknown;
 * }} config
 */
export const makeWebPageSchema = ({
  path,
  name,
  description,
  type = "WebPage",
  about = undefined,
  image = undefined,
  mainEntity = undefined
}) => {
  const pageUrl = absoluteSiteUrl(path);

  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name,
    description,
    inLanguage: "uk-UA",
    isPartOf: {
      "@id": `${siteUrl}/#website`
    },
    publisher: {
      "@id": `${siteUrl}/#organization`
    },
    ...(about ? { about } : {}),
    ...(image
      ? {
          primaryImageOfPage: {
            "@type": "ImageObject",
            url: absoluteSiteUrl(image)
          }
        }
      : {}),
    ...(mainEntity ? { mainEntity } : {})
  };
};

const vrProviderId = `${siteUrl}/vr/#localbusiness`;
const studioProviderId = `${siteUrl}/studio/#localbusiness`;
const vrOffers = bookingServices
  .filter((service) => service.area === "vr" || service.area === "event")
  .map((service) => makeBookingOffer(service, vrProviderId));

const studioOffers = [
  ...bookingServices
    .filter((service) => service.area === "studio")
    .map((service) => makeBookingOffer(service, studioProviderId)),
  ...studioServices.map((service) =>
    makeTextOffer({
      id: service.title.toLowerCase().replaceAll(" ", "-"),
      name: service.title,
      price: service.price,
      description: `${service.type}: ${service.text}`,
      providerId: studioProviderId,
      url: `${siteUrl}/studio/`
    })
  )
];

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${siteUrl}/#organization`,
  name: "Nova Space",
  url: siteUrl,
  logo: imageObject("/vr/nova-space-logo.webp", "Nova Space logo"),
  image: vrImages[0],
  telephone: phone,
  address,
  contactPoint: [makeContactPoint("UA")],
  sameAs: [vrInstagramUrl, studioInstagramUrl, vrTikTokUrl]
};

export const webSiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl}/#website`,
  name: "Nova Space",
  alternateName: [
    "Nova Space Бровари",
    "NOVA VR Бровари",
    "Nova PhotoStudio Бровари"
  ],
  url: siteUrl,
  inLanguage: "uk-UA",
  publisher: {
    "@id": `${siteUrl}/#organization`
  },
  potentialAction: makeReserveAction("Забронювати Nova Space")
};

export const novaVrSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${siteUrl}/vr/#localbusiness`,
  additionalType: "https://schema.org/EntertainmentBusiness",
  name: "NOVA VR | VR клуб Бровари",
  slogan: "VR, PS5, дні народження та події у Броварах",
  description:
    "VR клуб у Броварах для ігор, днів народження, корпоративів, побачень і компаній до 6 гравців.",
  url: `${siteUrl}/vr/`,
  image: vrImages,
  photo: vrImages,
  telephone: phone,
  priceRange: "200-7000 UAH",
  address,
  geo,
  hasMap: mapsUrl,
  currenciesAccepted: "UAH",
  knowsAbout: [
    "VR клуб Бровари",
    "віртуальна реальність",
    "день народження у VR",
    "PlayStation 5 Бровари",
    "корпоратив у VR"
  ],
  contactPoint: [makeContactPoint("UA")],
  parentOrganization: {
    "@id": `${siteUrl}/#organization`
  },
  potentialAction: makeReserveAction("Забронювати NOVA VR"),
  hasOfferCatalog: makeOfferCatalog("Послуги NOVA VR у Броварах", vrOffers),
  amenityFeature: [
    makeAmenity("6 VR-зон"),
    makeAmenity("PlayStation 5 зона"),
    makeAmenity("Зона відпочинку для свят"),
    makeAmenity("Фотограф за потреби")
  ],
  sameAs: [vrInstagramUrl, vrTikTokUrl],
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: week.filter((day) => day !== "Wednesday"),
      opens: "11:00",
      closes: "20:00"
    }
  ],
  areaServed: [
    {
      "@type": "City",
      name: "Бровари"
    },
    {
      "@type": "AdministrativeArea",
      name: "Київська область"
    }
  ]
};

export const novaPhotoStudioSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${siteUrl}/studio/#localbusiness`,
  additionalType: "https://schema.org/ProfessionalService",
  name: "Nova PhotoStudio | Фотостудія Бровари",
  slogan: "Світла фотостудія для портретів, сімейних фото та контенту",
  description:
    "Світла фотостудія у Броварах для портретів, сімейних зйомок, beauty-контенту та фото для брендів.",
  url: `${siteUrl}/studio/`,
  image: studioImages,
  photo: studioImages,
  telephone: phone,
  priceRange: "600 UAH/hour",
  address,
  geo,
  hasMap: mapsUrl,
  currenciesAccepted: "UAH",
  knowsAbout: [
    "фотостудія Бровари",
    "оренда фотостудії",
    "сімейна фотосесія",
    "портретна фотосесія",
    "контент зйомка"
  ],
  contactPoint: [makeContactPoint("UA")],
  parentOrganization: {
    "@id": `${siteUrl}/#organization`
  },
  potentialAction: makeReserveAction("Забронювати Nova PhotoStudio"),
  hasOfferCatalog: makeOfferCatalog("Послуги Nova PhotoStudio у Броварах", studioOffers),
  amenityFeature: [
    makeAmenity("Світлий студійний простір"),
    makeAmenity("Паперові фони"),
    makeAmenity("Затишна зона"),
    makeAmenity("Фотограф за потреби")
  ],
  sameAs: [studioInstagramUrl],
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: week.filter((day) => day !== "Wednesday"),
      opens: "11:00",
      closes: "20:00"
    }
  ],
  areaServed: [
    {
      "@type": "City",
      name: "Бровари"
    },
    {
      "@type": "AdministrativeArea",
      name: "Київська область"
    }
  ]
};
