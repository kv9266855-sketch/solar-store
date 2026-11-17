/* ============================================================
   SØLAR — catalog & site configuration
   ------------------------------------------------------------
   Это единственное место, где редактируется каталог.
   ВАЖНО: demo:true означает, что товар/цена/остатки — демонстрационные
   данные и не подтверждены производством. Пока demoMode:true,
   сайт показывает плашку TEST MODE и не принимает реальные заказы.
   ============================================================ */

window.SOLAR = window.SOLAR || {};

window.SOLAR.CONFIG = {
  demoMode: true,            // переключить в false только после подключения оплаты
  currency: "₴",
  brand: "SØLAR",
  est: "2026",
  founders: "STARKON × SLAYER",
  // Внешние сервисы (заполнить при подключении):
  newsletterEndpoint: null,  // напр. URL API рассылки
  paymentProvider: null,     // напр. "liqpay" | "monopay" | "fondy"
  deliveryProviders: ["nova-poshta", "ukrposhta", "pickup"],
  social: { instagram: null, tiktok: null, telegram: null } // реальные ссылки — когда будут
};

/* ---- Products ----
   fields:
   id, cat: tshirts|hoodies|bottoms|accessories
   price (UAH, demo), color: {en,uk,ru,fr}, colors: [hex...]
   sizes: {S: qty, M: qty, ...}  (qty 0 = sold out; отсутствие ключа = размера не существует)
   isNew, demo, ts (новизна, больше = новее)
   name/desc — мультиязычные
*/
window.SOLAR.PRODUCTS = [
  {
    id: "eclipse-tee",
    demo: true, isNew: true, ts: 100,
    cat: "tshirts",
    collection: "DROP 01 — ECLIPSE",
    name: "SØLAR ECLIPSE TEE",
    price: 1490,
    colorHex: ["#111111"],
    color: { en: "WASHED BLACK", uk: "WASHED BLACK", ru: "WASHED BLACK", fr: "NOIR DÉLAVÉ" },
    fit: "OVERSIZED FIT",
    design: "FRONT MINIMAL LOGO / BACK GRAPHIC PRINT",
    sizes: { S: 4, M: 6, L: 6, XL: 3 },
    gallery: ["front", "back", "detail"],
    desc: {
      en: "Oversized tee in washed black. Minimal Ø logo on the chest, large artistic eclipse print across the back. A study of light, shadow and identity.",
      uk: "Oversize-футболка у відтінку washed black. Мінімалістичний логотип Ø спереду та великий художній принт затемнення на спині. Дослідження світла, тіні та ідентичності.",
      ru: "Oversize-футболка в оттенке washed black. Минималистичный логотип Ø спереди и крупный художественный принт затмения на спине. Исследование света, тени и идентичности.",
      fr: "T-shirt oversize en noir délavé. Logo Ø minimaliste sur la poitrine, large imprimé artistique d'éclipse au dos. Une étude de la lumière, de l'ombre et de l'identité."
    },
    materials: {
      en: "Heavyweight cotton jersey. Exact composition and GSM to be confirmed by the manufacturer.",
      uk: "Щільний бавовняний джерсі. Точний склад і щільність будуть підтверджені виробником.",
      ru: "Плотный хлопковый джерси. Точный состав и плотность будут подтверждены производителем.",
      fr: "Jersey de coton épais. Composition exacte et grammage à confirmer par le fabricant."
    }
  },
  {
    id: "void-longsleeve",
    demo: true, isNew: true, ts: 90,
    cat: "tshirts",
    collection: "DROP 01 — ECLIPSE",
    name: "VOID LONGSLEEVE",
    price: 1790,
    colorHex: ["#0d0d0d", "#2a2a2a"],
    color: { en: "OFF BLACK / ASH", uk: "OFF BLACK / ASH", ru: "OFF BLACK / ASH", fr: "NOIR / CENDRE" },
    fit: "OVERSIZED FIT",
    design: "SLEEVE TYPE PRINT",
    sizes: { S: 3, M: 5, L: 4, XL: 0 },
    gallery: ["front", "back"],
    desc: {
      en: "Longsleeve with elongated body and typographic sleeve prints. Built for layering in the dark.",
      uk: "Лонгслів з подовженим силуетом і типографічними принтами на рукавах. Створений для багатошаровості.",
      ru: "Лонгслив с удлинённым силуэтом и типографическими принтами на рукавах. Создан для многослойности.",
      fr: "Manches longues au corps allongé avec imprimés typographiques sur les manches. Conçu pour la superposition."
    }
  },
  {
    id: "umbra-hoodie",
    demo: true, isNew: true, ts: 80,
    cat: "hoodies",
    collection: "DROP 01 — ECLIPSE",
    name: "UMBRA HOODIE",
    price: 2890,
    colorHex: ["#101010"],
    color: { en: "SHADOW BLACK", uk: "SHADOW BLACK", ru: "SHADOW BLACK", fr: "NOIR OMBRE" },
    fit: "OVERSIZED FIT",
    design: "EMBROIDERED LOGO / BACK PRINT",
    sizes: { S: 2, M: 4, L: 5, XL: 2 },
    gallery: ["front", "back", "detail"],
    desc: {
      en: "Heavy oversized hoodie with dropped shoulders, embroidered Ø mark and full-back eclipse graphic.",
      uk: "Важке oversize-худі зі спущеним плечем, вишитим знаком Ø та графікою затемнення на всю спину.",
      ru: "Тяжёлое oversize-худи со спущенным плечом, вышитым знаком Ø и графикой затмения на всю спину.",
      fr: "Hoodie oversize lourd aux épaules tombantes, marque Ø brodée et graphique d'éclipse au dos."
    }
  },
  {
    id: "penumbra-zip",
    demo: true, isNew: false, ts: 70,
    cat: "hoodies",
    collection: "DROP 01 — ECLIPSE",
    name: "PENUMBRA ZIP HOODIE",
    price: 3190,
    colorHex: ["#1a1a1a"],
    color: { en: "GRAPHITE", uk: "GRAPHITE", ru: "GRAPHITE", fr: "GRAPHITE" },
    fit: "RELAXED FIT",
    design: "METAL HARDWARE / TONAL PRINT",
    sizes: { S: 0, M: 2, L: 0, XL: 1 },
    gallery: ["front", "detail"],
    desc: {
      en: "Full-zip hoodie in graphite with cold metal hardware and tonal chest print.",
      uk: "Худі на блискавці у графітовому відтінку з холодною металевою фурнітурою та тональним принтом.",
      ru: "Худи на молнии в графитовом оттенке с холодной металлической фурнитурой и тональным принтом.",
      fr: "Hoodie zippé graphite avec quincaillerie en métal froid et imprimé ton sur ton."
    }
  },
  {
    id: "orbit-cargo",
    demo: true, isNew: true, ts: 60,
    cat: "bottoms",
    collection: "DROP 01 — ECLIPSE",
    name: "ORBIT CARGO PANTS",
    price: 2590,
    colorHex: ["#141414"],
    color: { en: "CARBON", uk: "CARBON", ru: "CARBON", fr: "CARBONE" },
    fit: "WIDE FIT",
    design: "UTILITY POCKETS / ADJUSTABLE HEM",
    sizes: { S: 3, M: 4, L: 3, XL: 2 },
    gallery: ["front", "detail"],
    desc: {
      en: "Wide cargo pants with utility pockets and adjustable hems. Industrial architecture for the body.",
      uk: "Широкі карго-штани з утилітарними кишенями та регульованим низом. Індустріальна архітектура для тіла.",
      ru: "Широкие карго-штаны с утилитарными карманами и регулируемым низом. Индустриальная архитектура для тела.",
      fr: "Pantalon cargo large avec poches utilitaires et ourlets réglables. Architecture industrielle pour le corps."
    }
  },
  {
    id: "gravity-pants",
    demo: true, isNew: false, ts: 50,
    cat: "bottoms",
    collection: "DROP 01 — ECLIPSE",
    name: "GRAVITY SWEATPANTS",
    price: 2190,
    colorHex: ["#0f0f0f"],
    color: { en: "WASHED BLACK", uk: "WASHED BLACK", ru: "WASHED BLACK", fr: "NOIR DÉLAVÉ" },
    fit: "RELAXED FIT",
    design: "TONAL EMBROIDERY",
    sizes: { S: 5, M: 6, L: 4, XL: 3 },
    gallery: ["front"],
    desc: {
      en: "Relaxed sweatpants in washed black with tonal Ø embroidery.",
      uk: "Вільні спортивні штани у washed black з тональною вишивкою Ø.",
      ru: "Свободные спортивные штаны в washed black с тональной вышивкой Ø.",
      fr: "Jogging décontracté en noir délavé avec broderie Ø ton sur ton."
    }
  },
  {
    id: "halo-cap",
    demo: true, isNew: true, ts: 40,
    cat: "accessories",
    collection: "DROP 01 — ECLIPSE",
    name: "HALO CAP",
    price: 890,
    colorHex: ["#111111"],
    color: { en: "BLACK", uk: "BLACK", ru: "BLACK", fr: "NOIR" },
    fit: "ONE SIZE",
    design: "CURVED BRIM / METAL EYELETS",
    sizes: { "ONE SIZE": 8 },
    gallery: ["front", "detail"],
    desc: {
      en: "Six-panel cap with curved brim, metal eyelets and embroidered Ø.",
      uk: "Шестипанельна кепка з вигнутим козирком, металевими люверсами та вишитим Ø.",
      ru: "Шестипанельная кепка с изогнутым козырьком, металлическими люверсами и вышитым Ø.",
      fr: "Casquette six panneaux à visière incurvée, œillets métalliques et Ø brodé."
    }
  },
  {
    id: "phase-tote",
    demo: true, isNew: false, ts: 30,
    cat: "accessories",
    collection: "DROP 01 — ECLIPSE",
    name: "PHASE TOTE",
    price: 690,
    colorHex: ["#0c0c0c"],
    color: { en: "BLACK", uk: "BLACK", ru: "BLACK", fr: "NOIR" },
    fit: "ONE SIZE",
    design: "HEAVY CANVAS / ECLIPSE PRINT",
    sizes: { "ONE SIZE": 0 },
    gallery: ["front"],
    desc: {
      en: "Heavy canvas tote with eclipse phase print.",
      uk: "Щільна полотняна сумка з принтом фаз затемнення.",
      ru: "Плотная холщовая сумка с принтом фаз затмения.",
      fr: "Tote bag en toile épaisse avec imprimé des phases d'éclipse."
    }
  }
];
