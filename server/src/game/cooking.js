// ============================================================
// game/cooking.js — P1: kitchen cooking (recipes, ingredients,
// timed cooks, auto-eat) + the "guests may use my kitchen" toggle.
//
// Flow: cook_start consumes ingredients and arms a timer → the client
// counts down → cook_finish validates the timer server-side and
// auto-eats (hunger/fun restore + cooking skill XP). cook_cancel
// abandons the pot (ingredients are already in it — no refund).
// Game-money only. All dishes, names and copy are original.
// ============================================================
import { FURN } from './data.js';
import { getVitality, saveVitality } from './vitality.js';

// ---------------- ingredients (game-money shop prices) ----------------
export const INGREDIENTS = {
  noodles:      { id: 'noodles',      name: 'Noodles',       icon: '🍜', price: 300 },
  egg:          { id: 'egg',          name: 'Eggs',          icon: '🥚', price: 200 },
  plantain:     { id: 'plantain',     name: 'Plantain',      icon: '🍌', price: 400 },
  palm_oil:     { id: 'palm_oil',     name: 'Palm Oil',      icon: '🫗', price: 500 },
  beans:        { id: 'beans',        name: 'Beans',         icon: '🫘', price: 600 },
  cook_oil:     { id: 'cook_oil',     name: 'Cooking Oil',   icon: '🧴', price: 450 },
  rice:         { id: 'rice',         name: 'Rice',          icon: '🍚', price: 700 },
  tomato:       { id: 'tomato',       name: 'Tomatoes',      icon: '🍅', price: 500 },
  pepper:       { id: 'pepper',       name: 'Pepper Mix',    icon: '🌶️', price: 300 },
  ofada_rice:   { id: 'ofada_rice',   name: 'Ofada Rice',    icon: '🍛', price: 900 },
  green_pepper: { id: 'green_pepper', name: 'Green Pepper',  icon: '🫑', price: 400 },
  melon:        { id: 'melon',        name: 'Egusi Melon',   icon: '🍈', price: 800 },
  yam:          { id: 'yam',          name: 'Yam Tubers',    icon: '🍠', price: 600 },
  chicken:      { id: 'chicken',      name: 'Chicken',       icon: '🍗', price: 1500 },
  fish:         { id: 'fish',         name: 'Fresh Fish',    icon: '🐟', price: 1200 },
  scent_leaf:   { id: 'scent_leaf',   name: 'Scent Leaf',    icon: '🌿', price: 250 },
  assorted:     { id: 'assorted',      name: 'Assorted Meat', icon: '🥩', price: 1800 },
};

export function ingredientById(id) {
  return INGREDIENTS[id] || null;
}

// ---------------- recipes ----------------
// Tiers: quick ≈ +35 hunger (6s), standard ≈ +55 (7–9s), feast +80 (12s).
// Favorites add a fun bonus. Cook XP feeds the cooking skill.
export const RECIPES = [
  { id: 'street_noodles', name: 'Street Noodles & Egg', icon: '🍜', secs: 6,
    needs: { noodles: 1, egg: 1 }, hunger: 35, fun: 4,  favorite: false, xp: 15,
    blurb: 'Two-minute noodles, Lagos speed.' },
  { id: 'dodo_pepper', name: 'Dodo & Pepper Mix', icon: '🍌', secs: 7,
    needs: { plantain: 2, palm_oil: 1 }, hunger: 40, fun: 2, favorite: false, xp: 18,
    blurb: 'Sweet plantain, angry pepper.' },
  { id: 'akara_pack', name: 'Akara Morning Pack', icon: '🫓', secs: 7,
    needs: { beans: 1, cook_oil: 1 }, hunger: 38, fun: 2, favorite: false, xp: 18,
    blurb: 'Crispy balls of morning joy.' },
  { id: 'peppered_chicken', name: 'Peppered Chicken', icon: '🍗', secs: 8,
    needs: { chicken: 1, pepper: 2 }, hunger: 50, fun: 5, favorite: true, xp: 22,
    blurb: 'Party-grade peppered goodness.' },
  { id: 'fisherman_soup', name: 'Fisherman Pepper Soup', icon: '🐟', secs: 9,
    needs: { fish: 2, scent_leaf: 1 }, hunger: 55, fun: 3, favorite: false, xp: 25,
    blurb: 'Hot, fresh, clears the head.' },
  { id: 'party_jollof', name: 'Smoky Party Jollof', icon: '🍚', secs: 11,
    needs: { rice: 2, tomato: 2, pepper: 1 }, hunger: 60, fun: 8, favorite: true, xp: 30,
    blurb: 'Firewood smoke included.' },
  { id: 'ofada_ayamase', name: 'Ofada & Ayamase', icon: '🍛', secs: 12,
    needs: { ofada_rice: 2, green_pepper: 2 }, hunger: 65, fun: 4, favorite: false, xp: 32,
    blurb: 'Local rice, designer stew.' },
  { id: 'owambe_platter', name: 'Owambe Grand Platter', icon: '🎉', secs: 12,
    needs: { rice: 3, chicken: 2, plantain: 2, assorted: 1 }, hunger: 80, fun: 10, favorite: true, xp: 40,
    blurb: 'A whole celebration on one tray.' },
];

export function recipeById(id) {
  return RECIPES.find(r => r.id === id) || null;
}

// A kitchen is any placed furniture whose catalogue category is 'kitchen'.
export function hasKitchen(placedItems) {
  for (const raw of placedItems || []) {
    const id = typeof raw === 'string' ? raw : raw && raw.item;
    const def = id && FURN[id];
    if (def && def.category === 'kitchen') return true;
  }
  return false;
}

export function hasBed(placedItems) {
  for (const raw of placedItems || []) {
    const id = typeof raw === 'string' ? raw : raw && raw.item;
    if (id === 'bed') return true;
  }
  return false;
}

// Ingredients the player is missing for a recipe: {id: qtyMissing}.
export function missingIngredients(items, recipe) {
  const missing = {};
  for (const [id, qty] of Object.entries(recipe.needs || {})) {
    const have = Math.max(0, Math.floor(Number((items || {})[id]) || 0));
    if (have < qty) missing[id] = qty - have;
  }
  return missing;
}

export function missingCost(missing) {
  let total = 0;
  for (const [id, qty] of Object.entries(missing || {})) {
    const ing = ingredientById(id);
    if (ing) total += ing.price * qty;
  }
  return total;
}

function consume(items, needs) {
  const out = { ...(items || {}) };
  for (const [id, qty] of Object.entries(needs || {})) {
    out[id] = Math.max(0, Math.floor(Number(out[id]) || 0) - qty);
    if (out[id] <= 0) delete out[id];
  }
  return out;
}

// ---- cook lifecycle (state lives in vitality.timers.cook) ----
export function startCookState(state, recipeId, now = Date.now()) {
  const recipe = recipeById(recipeId);
  if (!recipe) return { error: 'Unknown recipe.' };
  if (state.timers.cook) return { error: 'Something is already on the fire — finish it first.' };
  const missing = missingIngredients(state.kitchen.items, recipe);
  if (Object.keys(missing).length) return { error: 'Missing ingredients.', missing };
  state.kitchen.items = consume(state.kitchen.items, recipe.needs);
  state.timers.cook = { recipeId: recipe.id, endsAt: now + recipe.secs * 1000, startedAt: now };
  return { ok: true, timer: state.timers.cook, recipe };
}

export function finishCookState(state, now = Date.now()) {
  const t = state.timers.cook;
  if (!t) return { error: 'Nothing is cooking.' };
  const recipe = recipeById(t.recipeId);
  if (!recipe) { state.timers.cook = null; return { error: 'That pot went missing.' }; }
  if (now < t.endsAt) {
    return { error: 'Still cooking — patience.', remainingMs: t.endsAt - now };
  }
  state.timers.cook = null;
  state.cooksDone = (Number(state.cooksDone) || 0) + 1;
  // Auto-eat: the meal is devoured the moment it is done.
  return {
    ok: true,
    recipe,
    hunger: recipe.hunger,
    fun: recipe.fun,
    xp: recipe.xp,
  };
}

export function cancelCookState(state) {
  const t = state.timers.cook;
  if (!t) return { error: 'Nothing is cooking.' };
  state.timers.cook = null;
  return { ok: true, recipe: recipeById(t.recipeId) };
}

// ---- kitchen inventory helpers ----
export async function addIngredients(userId, adds) {
  const st = await getVitality(userId);
  for (const [id, qty] of Object.entries(adds || {})) {
    if (!ingredientById(id)) continue;
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    if (q <= 0) continue;
    st.kitchen.items[id] = Math.max(0, Math.floor(Number(st.kitchen.items[id]) || 0)) + q;
  }
  await saveVitality(userId, st);
  return st.kitchen.items;
}

export async function setKitchenGuests(userId, allow) {
  const st = await getVitality(userId);
  st.kitchen.guests_ok = !!allow;
  await saveVitality(userId, st);
  return st.kitchen.guests_ok;
}
