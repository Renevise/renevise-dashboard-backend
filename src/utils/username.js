function normalizePart(str) {
    return str.trim().toLowerCase().replace(/\s+/g, '');
}

function generateUserName(firstName, lastName) {
    return `${normalizePart(firstName)}.${normalizePart(lastName)}`;
}

async function resolveUniqueUserName(firstName, lastName, userModel, excludeId = null) {
    const base = generateUserName(firstName, lastName);

    const firstQuery = excludeId
        ? { userName: base, _id: { $ne: excludeId } }
        : { userName: base };

    const exists = await userModel.exists(firstQuery);
    if (!exists) return base;

    for (let n = 2; n < 100; n++) {
        const candidate = `${base}${n}`;
        const q = excludeId
            ? { userName: candidate, _id: { $ne: excludeId } }
            : { userName: candidate };
        const taken = await userModel.exists(q);
        if (!taken) return candidate;
    }

    throw new Error('Unable to generate a unique username');
}

module.exports = { generateUserName, resolveUniqueUserName };
