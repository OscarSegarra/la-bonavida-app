/**
 * The recipe seed dataset.
 *
 * Applied by `pnpm run seed:recipes`, which validates the whole thing
 * before writing anything and applies it in dependency order, so a recipe
 * using another as a sub-recipe is imported after it.
 *
 * Small on purpose, and chosen to exercise every branch rather than to be
 * a useful cookbook yet: a sub-recipe, two "basic" entries (one line, no
 * steps), a nutrient override, a mass yield and a volume yield, and a
 * recipe with a min_servings floor. Curation continues against working
 * infrastructure - the same stance Phase 2 took when it shipped 62
 * ingredients against a target of 150-250.
 *
 * Every recipe is written in all three locales, because we write them. A
 * step missing a locale the recipe declares is rejected: a recipe that is
 * Catalan for four steps and Spanish for the fifth is visibly broken.
 */

import type { SeedRecipe } from "./recipe-types.ts";

export const recipes: SeedRecipe[] = [
  // ---------------------------------------------------------------
  // Basics: one line, no steps. These are how a meal plan says
  // "breakfast: an apple" without needing a second concept, and what the
  // browse list hides by default so real dishes are not crowded out.
  // ---------------------------------------------------------------
  {
    code: "manzana",
    servings: 1,
    yield: { quantity: 180, unit: "g" },
    translations: {
      es: { title: "Manzana" },
      ca: { title: "Poma" },
      en: { title: "Apple" },
    },
    lines: [{ ingredient: "manzana", quantity: 1, unit: "unit" }],
    tags: ["desayuno"],
  },
  {
    code: "vaso_de_leche",
    servings: 1,
    yield: { quantity: 250, unit: "ml" },
    translations: {
      es: { title: "Vaso de leche" },
      ca: { title: "Got de llet" },
      en: { title: "Glass of milk" },
    },
    lines: [{ ingredient: "leche_entera", quantity: 250, unit: "ml" }],
    tags: ["desayuno"],
  },

  // ---------------------------------------------------------------
  // A sub-recipe, and the reason yield cannot be derived: 300 g of raw
  // rice comes out at roughly 750 g cooked, because it absorbs water.
  // ---------------------------------------------------------------
  {
    code: "arroz_blanco_cocido",
    servings: 4,
    yield: { quantity: 750, unit: "g" },
    translations: {
      es: {
        title: "Arroz blanco cocido",
        description: "La base para muchos platos, y también una guarnición por sí sola.",
      },
      ca: {
        title: "Arròs blanc bullit",
        description: "La base de molts plats, i també una guarnició per si sola.",
      },
      en: {
        title: "Cooked white rice",
        description: "The base for many dishes, and a side on its own.",
      },
    },
    steps: [
      {
        es: "Enjuaga el arroz bajo el grifo hasta que el agua salga clara.",
        ca: "Esbandeix l'arròs sota l'aixeta fins que l'aigua surti clara.",
        en: "Rinse the rice under the tap until the water runs clear.",
      },
      {
        es: "Ponlo en una olla con el doble de agua y la sal, y lleva a ebullición.",
        ca: "Posa'l en una olla amb el doble d'aigua i la sal, i porta'l a ebullició.",
        en: "Put it in a pan with twice its volume of water and the salt, and bring to the boil.",
      },
      {
        es: "Baja el fuego, tapa y cuece 15 minutos sin destapar.",
        ca: "Abaixa el foc, tapa i cou 15 minuts sense destapar.",
        en: "Lower the heat, cover, and cook for 15 minutes without lifting the lid.",
      },
      {
        es: "Apaga el fuego y deja reposar 5 minutos antes de remover.",
        ca: "Apaga el foc i deixa reposar 5 minuts abans de remenar.",
        en: "Turn off the heat and let it rest for 5 minutes before stirring.",
      },
    ],
    lines: [
      { ingredient: "arroz_blanco", quantity: 300, unit: "g" },
      { ingredient: "agua", quantity: 600, unit: "ml" },
      { ingredient: "sal", quantity: 1, unit: "tsp" },
    ],
    tags: ["guarnicion", "rapido"],
  },

  // The recipe that uses it. Its rice line points at a RECIPE, not at the
  // raw ingredient - which is what Phase 5's shopping list will have to
  // recurse through to work out that raw rice is what you actually buy.
  {
    code: "arroz_con_verduras",
    servings: 4,
    yield: { quantity: 1200, unit: "g" },
    translations: {
      es: { title: "Arroz con verduras" },
      ca: { title: "Arròs amb verdures" },
      en: { title: "Rice with vegetables" },
    },
    steps: [
      {
        es: "Calienta el aceite en una sartén amplia y sofríe la cebolla y el ajo.",
        ca: "Escalfa l'oli en una paella ampla i sofregeix la ceba i l'all.",
        en: "Heat the oil in a wide pan and soften the onion and garlic.",
      },
      {
        es: "Añade el calabacín y el pimiento en dados y cocina 8 minutos.",
        ca: "Afegeix el carbassó i el pebrot a daus i cuina 8 minuts.",
        en: "Add the diced courgette and pepper and cook for 8 minutes.",
      },
      {
        es: "Incorpora el arroz ya cocido, remueve y calienta un par de minutos.",
        ca: "Incorpora l'arròs ja bullit, remena i escalfa un parell de minuts.",
        en: "Fold in the cooked rice, stir, and warm through for a couple of minutes.",
      },
    ],
    lines: [
      { recipe: "arroz_blanco_cocido", quantity: 750, unit: "g" },
      { ingredient: "calabacin", quantity: 200, unit: "g" },
      { ingredient: "pimiento_rojo", quantity: 150, unit: "g" },
      { ingredient: "cebolla", quantity: 100, unit: "g" },
      { ingredient: "ajo", quantity: 1, unit: "unit" },
      { ingredient: "aceite_oliva_virgen_extra", quantity: 20, unit: "ml" },
      { ingredient: "sal", quantity: 1, unit: "tsp" },
    ],
    tags: ["comida", "una_olla"],
  },

  // ---------------------------------------------------------------
  // Ordinary dishes
  // ---------------------------------------------------------------
  {
    code: "tortilla_patatas",
    servings: 4,
    // A tortilla for one is not a tortilla - the pan will not do it.
    min_servings: 2,
    yield: { quantity: 800, unit: "g" },
    translations: {
      es: { title: "Tortilla de patatas" },
      ca: { title: "Truita de patates" },
      en: { title: "Potato omelette" },
    },
    steps: [
      {
        es: "Pela y corta las patatas en láminas finas, y la cebolla en juliana.",
        ca: "Pela i talla les patates a làmines fines, i la ceba a juliana.",
        en: "Peel and thinly slice the potatoes, and slice the onion.",
      },
      {
        es: "Confítalas a fuego suave en el aceite hasta que estén tiernas, unos 20 minutos.",
        ca: "Confita-les a foc suau amb l'oli fins que siguin tendres, uns 20 minuts.",
        en: "Cook them gently in the oil until tender, about 20 minutes.",
      },
      {
        es: "Bate los huevos con la sal, escurre las patatas y mézclalo todo.",
        ca: "Bat els ous amb la sal, escorre les patates i barreja-ho tot.",
        en: "Beat the eggs with the salt, drain the potatoes, and combine.",
      },
      {
        es: "Cuaja en la sartén 4 minutos por cada lado. Ajusta la sal al gusto.",
        ca: "Quallà-ho a la paella 4 minuts per cada costat. Ajusta la sal al gust.",
        en: "Set it in the pan for 4 minutes a side. Adjust the salt to taste.",
      },
    ],
    lines: [
      { ingredient: "patata", quantity: 600, unit: "g" },
      { ingredient: "huevo", quantity: 5, unit: "unit" },
      { ingredient: "cebolla", quantity: 150, unit: "g" },
      { ingredient: "aceite_oliva_virgen_extra", quantity: 40, unit: "ml" },
      { ingredient: "sal", quantity: 1, unit: "tsp" },
    ],
    tags: ["comida", "cena"],
  },
  {
    code: "ensalada_mixta",
    servings: 2,
    yield: { quantity: 450, unit: "g" },
    translations: {
      es: { title: "Ensalada mixta" },
      ca: { title: "Amanida mixta" },
      en: { title: "Mixed salad" },
    },
    steps: [
      {
        es: "Lava y trocea la lechuga, y corta el tomate y la cebolla.",
        ca: "Renta i trosseja l'enciam, i talla el tomàquet i la ceba.",
        en: "Wash and tear the lettuce, and slice the tomato and onion.",
      },
      {
        es: "Aliña con el aceite y la sal justo antes de servir.",
        ca: "Amaneix amb l'oli i la sal just abans de servir.",
        en: "Dress with the oil and salt just before serving.",
      },
    ],
    lines: [
      { ingredient: "lechuga", quantity: 200, unit: "g" },
      { ingredient: "tomate", quantity: 150, unit: "g" },
      { ingredient: "cebolla", quantity: 50, unit: "g" },
      { ingredient: "aceite_oliva_virgen_extra", quantity: 15, unit: "ml" },
      { ingredient: "sal", quantity: 1, unit: "tsp" },
    ],
    tags: ["cena", "rapido", "guarnicion"],
  },
  {
    code: "lentejas_guisadas",
    servings: 4,
    min_servings: 2,
    yield: { quantity: 1600, unit: "g" },
    translations: {
      es: {
        title: "Lentejas guisadas",
        description: "Mejoran de un día para otro.",
      },
      ca: {
        title: "Llenties guisades",
        description: "Milloren d'un dia per l'altre.",
      },
      en: {
        title: "Stewed lentils",
        description: "Better the next day.",
      },
    },
    steps: [
      {
        es: "Sofríe la cebolla, la zanahoria y el ajo picados en el aceite.",
        ca: "Sofregeix la ceba, la pastanaga i l'all picats amb l'oli.",
        en: "Soften the chopped onion, carrot and garlic in the oil.",
      },
      {
        es: "Añade las lentejas y el agua, y lleva a ebullición.",
        ca: "Afegeix les llenties i l'aigua, i porta-ho a ebullició.",
        en: "Add the lentils and the water, and bring to the boil.",
      },
      {
        es: "Cuece a fuego lento 40 minutos, hasta que estén tiernas. Sala al final.",
        ca: "Cou a foc lent 40 minuts, fins que siguin tendres. Sala al final.",
        en: "Simmer for 40 minutes until tender. Salt at the end.",
      },
    ],
    lines: [
      { ingredient: "lenteja", quantity: 400, unit: "g" },
      { ingredient: "cebolla", quantity: 150, unit: "g" },
      { ingredient: "zanahoria", quantity: 150, unit: "g" },
      { ingredient: "ajo", quantity: 2, unit: "unit" },
      { ingredient: "aceite_oliva_virgen_extra", quantity: 30, unit: "ml" },
      { ingredient: "agua", quantity: 1200, unit: "ml" },
      { ingredient: "sal", quantity: 2, unit: "tsp" },
    ],
    tags: ["comida", "una_olla"],
  },

  // The one carrying a nutrient override. Roasting drives off water, so
  // the finished dish weighs appreciably less than what went in - which
  // does not change its total energy much, but does change everything
  // stated per 100 g. The override records the measured total rather than
  // letting the sum imply a precision it does not have.
  {
    code: "pollo_al_horno",
    servings: 4,
    yield: { quantity: 700, unit: "g" },
    translations: {
      es: { title: "Pollo al horno con limón" },
      ca: { title: "Pollastre al forn amb llimona" },
      en: { title: "Roast chicken with lemon" },
    },
    steps: [
      {
        es: "Precalienta el horno a 200 °C.",
        ca: "Preescalfa el forn a 200 °C.",
        en: "Heat the oven to 200 °C.",
      },
      {
        es: "Coloca las pechugas en una fuente, riega con el aceite y el zumo de limón, y sala.",
        ca: "Col·loca els pits en una safata, ruixa amb l'oli i el suc de llimona, i sala.",
        en: "Put the breasts in a dish, pour over the oil and lemon juice, and salt.",
      },
      {
        es: "Hornea 25 minutos, regando con los jugos a mitad de cocción.",
        ca: "Fornea 25 minuts, ruixant amb els sucs a mitja cocció.",
        en: "Roast for 25 minutes, basting with the juices halfway through.",
      },
    ],
    lines: [
      { ingredient: "pollo_pechuga", quantity: 800, unit: "g" },
      { ingredient: "limon", quantity: 1, unit: "unit" },
      { ingredient: "aceite_oliva_virgen_extra", quantity: 25, unit: "ml" },
      { ingredient: "sal", quantity: 1, unit: "tsp" },
    ],
    tags: ["comida", "cena", "horno"],
    nutrient_overrides: {
      energy_kcal: 1100,
      energy_kj: 4602,
    },
  },
];
