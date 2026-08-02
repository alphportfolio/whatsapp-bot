const { sendText, sendButtons, sendList } = require("../whatsapp");
const { supabase } = require("../supabaseClient");

const AMENITIES = [
  "Parking", "Lift", "Power Backup", "Wi-Fi", "Balcony",
  "Air Conditioner", "Geyser", "Modular Kitchen", "Security",
  "CCTV", "Gym", "Swimming Pool",
];

const PROPERTY_TYPES = [
  { id: "1RK", title: "1 RK" },
  { id: "1BHK", title: "1 BHK" },
  { id: "2BHK", title: "2 BHK" },
  { id: "3BHK", title: "3 BHK" },
  { id: "4+BHK", title: "4+ BHK" },
  { id: "villa", title: "Villa" },
  { id: "independent_house", title: "Independent House" },
  { id: "pg", title: "PG" },
];

// Small helper: a free-text step that just stores the trimmed value under `field`
function textStep({ id, prompt, field, next, validate }) {
  return {
    id,
    ask: async (to) => sendText(to, prompt),
    parse: (incoming) => {
      if (incoming.type !== "text" || !incoming.value) {
        return { ok: false, error: "Please reply with a text answer." };
      }
      if (validate) {
        const v = validate(incoming.value);
        if (v !== true) return { ok: false, error: v };
      }
      return { ok: true, value: incoming.value };
    },
    save: (value, flowData) => {
      flowData[field] = value;
    },
    next,
  };
}

// Small helper: a button/list step with a fixed set of options
function choiceStep({ id, prompt, options, field, useList, listButtonLabel, next }) {
  return {
    id,
    ask: async (to) => {
      if (useList) {
        await sendList(to, prompt, listButtonLabel || "Choose", options.map((o) => ({ id: o.id, title: o.title })));
      } else {
        await sendButtons(to, prompt, options);
      }
    },
    parse: (incoming) => {
      const valid = options.some((o) => o.id === incoming.value);
      if (!valid) return { ok: false, error: "Please choose one of the options shown." };
      return { ok: true, value: incoming.value };
    },
    save: (value, flowData) => {
      flowData[field] = value;
    },
    next,
  };
}

const ownerSteps = {
  // ---- Step 2: Phone Number Verification ----
  phone_verification: {
    id: "phone_verification",
    ask: async (to) =>
      sendButtons(to, "Great! We'll use this WhatsApp number as your registered contact. Continue?", [
        { id: "yes", title: "✅ Yes" },
        { id: "other", title: "📱 Use another number" },
      ]),
    parse: (incoming) => {
      if (incoming.type !== "button" || !["yes", "other"].includes(incoming.value)) {
        return { ok: false, error: "Please tap one of the buttons above." };
      }
      return { ok: true, value: incoming.value };
    },
    save: (value, flowData) => {
      flowData.phone_confirmed = value === "yes";
    },
    next: () => "owner_name",
  },

  // ---- Step 3: Owner Information (name) ----
  owner_name: textStep({
    id: "owner_name",
    prompt: "What's your name?",
    field: "name",
    next: () => "owner_role",
  }),

  owner_role: choiceStep({
    id: "owner_role",
    prompt: "Which best describes you?",
    field: "role",
    useList: true,
    listButtonLabel: "Select role",
    options: [
      { id: "owner", title: "🏠 Property Owner" },
      { id: "family_member", title: "👨‍👩‍👧 Family Member" },
      { id: "builder", title: "🏢 Builder" },
      { id: "agent", title: "🏘 Real Estate Agent" },
    ],
    next: () => "property_location",
  }),

  // ---- Step 4: Property Location ----
  // NOTE: MVP stores the raw text as `area`. City/area splitting via AI extraction is a
  // future improvement — flagged here rather than guessed at.
  property_location: textStep({
    id: "property_location",
    prompt: "Where is your property located? (e.g. Bellandur, Sarjapur, Whitefield, HSR Layout)",
    field: "area",
    next: () => "property_address",
  }),

  // ---- Step 5: Property Address ----
  property_address: textStep({
    id: "property_address",
    prompt:
      "Please send the complete address of your property.\n\n🔒 Privacy Notice: The exact address will never be displayed publicly. It is only used for verification and tenant matching.",
    field: "address",
    next: () => "property_type",
  }),

  // ---- Step 6: Property Type ----
  property_type: choiceStep({
    id: "property_type",
    prompt: "Select the property type:",
    field: "property_type",
    useList: true,
    listButtonLabel: "Select type",
    options: PROPERTY_TYPES,
    next: () => "rent_amount",
  }),

  // ---- Step 7: Rent Details ----
  rent_amount: textStep({
    id: "rent_amount",
    prompt: "What is your monthly rent? (numbers only, e.g. 25000)",
    field: "rent",
    validate: (v) => (/^\d+$/.test(v) ? true : "Please enter numbers only, e.g. 25000."),
    next: () => "deposit_amount",
  }),

  deposit_amount: textStep({
    id: "deposit_amount",
    prompt: "What is your security deposit? (numbers only)",
    field: "deposit",
    validate: (v) => (/^\d+$/.test(v) ? true : "Please enter numbers only, e.g. 150000."),
    next: () => "lease_term",
  }),

  lease_term: textStep({
    id: "lease_term",
    prompt: "What is the minimum lease term? (e.g. 11 months, 1 year, flexible)",
    field: "lease_term",
    next: () => "maintenance_included",
  }),

  maintenance_included: {
    id: "maintenance_included",
    ask: async (to) =>
      sendButtons(to, "Is Maintenance Included?", [
        { id: "yes", title: "✅ Yes" },
        { id: "no", title: "❌ No" },
      ]),
    parse: (incoming) => {
      if (incoming.type !== "button" || !["yes", "no"].includes(incoming.value)) {
        return { ok: false, error: "Please tap Yes or No." };
      }
      return { ok: true, value: incoming.value === "yes" };
    },
    save: (value, flowData) => {
      flowData.maintenance_included = value;
    },
    // Agents get one extra question here; everyone else skips straight to amenities.
    next: (flowData) => (flowData.role === "agent" ? "brokerage_fee" : "amenities"),
  },

  brokerage_fee: textStep({
    id: "brokerage_fee",
    prompt: "Is there a brokerage fee for tenants, and how much?",
    field: "brokerage_fee_note",
    next: () => "amenities",
  }),

  // ---- Step 8: Amenities (multi-select via numbered reply) ----
  amenities: {
    id: "amenities",
    ask: async (to) => {
      const list = AMENITIES.map((a, i) => `${i + 1}. ${a}`).join("\n");
      await sendText(
        to,
        `Select all amenities that apply. Reply with the numbers, separated by commas.\n\n${list}\n\nExample: 1,4,9`
      );
    },
    parse: (incoming) => {
      if (incoming.type !== "text") return { ok: false, error: "Please reply with numbers, e.g. 1,4,9." };
      const nums = incoming.value
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= AMENITIES.length);
      if (nums.length === 0) {
        return { ok: false, error: `Please reply with valid numbers between 1 and ${AMENITIES.length}, e.g. 1,4,9.` };
      }
      return { ok: true, value: [...new Set(nums)].map((n) => AMENITIES[n - 1]) };
    },
    save: (value, flowData) => {
      flowData.amenities = value;
    },
    next: () => "furnishing_status",
  },

  // ---- Step 9: Furnishing Status ----
  furnishing_status: choiceStep({
    id: "furnishing_status",
    prompt: "Is the property furnished, semi-furnished, or unfurnished?",
    field: "furnishing",
    options: [
      { id: "fully_furnished", title: "🪑 Fully Furnished" },
      { id: "semi_furnished", title: "🛋️ Semi-Furnished" },
      { id: "unfurnished", title: "📦 Unfurnished" },
    ],
    next: () => "tenant_pref_type",
  }),

  // ---- Step 10: Tenant Preferences (mandatory) ----
  tenant_pref_type: choiceStep({
    id: "tenant_pref_type",
    prompt: "Who would you prefer to rent to?",
    field: "preferred_tenant_type",
    useList: true,
    listButtonLabel: "Select",
    options: [
      { id: "students", title: "🎓 Students" },
      { id: "working_professionals", title: "💼 Working Professionals" },
      { id: "family", title: "👨‍👩‍👧 Family" },
      { id: "any", title: "🧑‍🤝‍🧑 Any / No preference" },
    ],
    next: () => "tenant_pref_gender",
  }),

  tenant_pref_gender: choiceStep({
    id: "tenant_pref_gender",
    prompt: "Any gender preference for tenants?",
    field: "gender_preference",
    options: [
      { id: "male_only", title: "♂️ Male only" },
      { id: "female_only", title: "♀️ Female only" },
      { id: "no_preference", title: "🧑‍🤝‍🧑 No preference" },
    ],
    next: () => "tenant_pref_pets",
  }),

  tenant_pref_pets: choiceStep({
    id: "tenant_pref_pets",
    prompt: "Are pets allowed?",
    field: "pet_policy",
    options: [
      { id: "yes", title: "🐾 Yes" },
      { id: "no", title: "🚫 No" },
      { id: "case_by_case", title: "🤝 Case-by-case" },
    ],
    next: () => "tenant_pref_food",
  }),

  tenant_pref_food: choiceStep({
    id: "tenant_pref_food",
    prompt: "Any food preference in the house?",
    field: "food_preference",
    options: [
      { id: "veg_only", title: "🥦 Vegetarian only" },
      { id: "non_veg_okay", title: "🍗 Non-veg okay" },
      { id: "no_preference", title: "🤷 No preference" },
    ],
    next: () => "tenant_pref_rules",
  }),

  tenant_pref_rules: textStep({
    id: "tenant_pref_rules",
    prompt: "Anything else prospective tenants should know? (smoking, drinking, visitor policy, etc.) Reply with details, or type 'none'.",
    field: "additional_house_rules",
    next: () => "availability",
  }),

  // ---- Step 11: Availability ----
  availability: {
    id: "availability",
    ask: async (to) =>
      sendButtons(to, "Is this property currently available for rent?", [
        { id: "available_now", title: "✅ Available Now" },
        { id: "available_from", title: "📅 Available From (Date)" },
      ]),
    parse: (incoming) => {
      if (incoming.type !== "button" || !["available_now", "available_from"].includes(incoming.value)) {
        return { ok: false, error: "Please tap one of the options above." };
      }
      return { ok: true, value: incoming.value };
    },
    save: (value, flowData) => {
      flowData.availability_type = value;
    },
    next: (flowData) => (flowData.availability_type === "available_from" ? "availability_date" : "review"),
  },

  availability_date: textStep({
    id: "availability_date",
    prompt: "What date will it be available from? (format: YYYY-MM-DD, e.g. 2026-09-01)",
    field: "available_from_date",
    validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? true : "Please use the format YYYY-MM-DD, e.g. 2026-09-01."),
    next: () => "review",
  }),

  // ---- Review before saving ----
  review: {
    id: "review",
    ask: async (to, flowData) => {
      const summary = [
        `*Property Type:* ${flowData.property_type}`,
        `*Location:* ${flowData.area}`,
        `*Rent:* ₹${flowData.rent}/month`,
        `*Deposit:* ₹${flowData.deposit}`,
        `*Lease Term:* ${flowData.lease_term}`,
        `*Maintenance Included:* ${flowData.maintenance_included ? "Yes" : "No"}`,
        `*Amenities:* ${(flowData.amenities || []).join(", ") || "None selected"}`,
        `*Furnishing:* ${flowData.furnishing}`,
        `*Preferred Tenants:* ${flowData.preferred_tenant_type}`,
        `*Gender Preference:* ${flowData.gender_preference}`,
        `*Pets:* ${flowData.pet_policy}`,
        `*Food Preference:* ${flowData.food_preference}`,
        `*Availability:* ${flowData.availability_type === "available_now" ? "Available Now" : `From ${flowData.available_from_date}`}`,
      ].join("\n");

      await sendButtons(to, `Here's a summary of your listing:\n\n${summary}\n\nIs everything correct?`, [
        { id: "confirm", title: "✅ Publish" },
        { id: "restart", title: "✏️ Start Over" },
      ]);
    },
    parse: (incoming) => {
      if (incoming.type !== "button" || !["confirm", "restart"].includes(incoming.value)) {
        return { ok: false, error: "Please tap one of the options above." };
      }
      return { ok: true, value: incoming.value };
    },
    save: (value, flowData) => {
      flowData.review_decision = value;
    },
    // "restart" is a simplification for MVP — full field-level editing (per the spec's
    // "✏️ Edit Details") is a follow-up, not yet built.
    next: (flowData) => (flowData.review_decision === "confirm" ? "FINALIZE" : "FINALIZE"),
  },
};

// Called when the review step resolves. Writes the owner + listing rows to Supabase.
// A "restart" decision currently also finalizes as an empty reset — full edit support
// is a known follow-up (see review step's `next` comment).
async function finalizeOwnerOnboarding(whatsapp_number, flowData) {
  if (flowData.review_decision !== "confirm") {
    await sendText(whatsapp_number, "No problem — you can start again anytime by saying hi 👋");
    return;
  }

  // Upsert the owner
  const { data: owner, error: ownerError } = await supabase
    .from("owners")
    .upsert(
      {
        whatsapp_number,
        whatsapp_display_name: flowData.whatsapp_display_name || null,
        name: flowData.name,
        role: flowData.role,
      },
      { onConflict: "whatsapp_number" }
    )
    .select()
    .single();

  if (ownerError) {
    console.error("Error saving owner:", ownerError);
    await sendText(whatsapp_number, "Something went wrong saving your details. Please try again in a moment.");
    return;
  }

  const displayId = `RN${Math.floor(10000 + Math.random() * 89999)}`;

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .insert({
      display_id: displayId,
      owner_id: owner.owner_id,
      area: flowData.area,
      address: flowData.address,
      property_type: flowData.property_type,
      rent: parseInt(flowData.rent, 10),
      deposit: parseInt(flowData.deposit, 10),
      lease_term: flowData.lease_term,
      maintenance_included: flowData.maintenance_included,
      brokerage_fee: flowData.brokerage_fee_note ? null : null, // numeric fee parsing left for a follow-up; note stored separately if needed
      amenities: flowData.amenities || [],
      furnishing: flowData.furnishing,
      preferred_tenant_type: flowData.preferred_tenant_type,
      gender_preference: flowData.gender_preference,
      pet_policy: flowData.pet_policy,
      food_preference: flowData.food_preference,
      additional_house_rules: flowData.additional_house_rules,
      availability_type: flowData.availability_type,
      available_from_date: flowData.available_from_date || null,
      status: "draft", // photos + verification still pending
    })
    .select()
    .single();

  if (listingError) {
    console.error("Error saving listing:", listingError);
    await sendText(whatsapp_number, "Something went wrong saving your listing. Please try again in a moment.");
    return;
  }

  await sendText(
    whatsapp_number,
    `🎉 Your draft listing has been created!\n\nProperty ID: ${displayId}\n\nNext, you'll need to upload photos to publish it — we'll send you a secure upload link shortly. (Photo upload coming next!)`
  );
}

module.exports = { ownerSteps, finalizeOwnerOnboarding };
