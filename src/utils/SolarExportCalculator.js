class SolarExportCalculator {
  static calculateMonthlyCredit(units, tariffTemplate) {
    if (!units || units <= 0) return 0;
    if (!tariffTemplate) return 0;

    const state = (tariffTemplate._id || 'tamil-nadu').toLowerCase();
    const slabs = tariffTemplate.slabs;
    let cost = 0;

    // --- KERALA LOGIC ---
    if (state === 'kerala') {
      const telescopic = slabs?.telescopic_up_to_250 || [];
      const nonTelescopic = slabs?.non_telescopic_above_250 || [];

      // Determine threshold (standard 250)
      let threshold = 250;
      if (telescopic.length > 0) {
        const lastSlab = telescopic[telescopic.length - 1];
        threshold = (lastSlab.to === null) ? Infinity : Number(lastSlab.to);
      }

      if (units <= threshold) {
        // CASE A: Telescopic (Progressive calculation in buckets)
        let remaining = units;
        for (const slab of telescopic) {
          if (remaining <= 0) break;
          
          const slabStart = Number(slab.from || 0);
          const slabEnd = (slab.to === null) ? Infinity : Number(slab.to);

          // ✅ REAL FIX: Calculate accurate capacity without bounds overflow
          const slabCapacity = slabEnd === Infinity 
            ? remaining 
            : (slabEnd - slabStart); 

          const slabUnits = Math.min(remaining, slabCapacity);
          
          cost += slabUnits * Number(slab.rate);
          remaining -= slabUnits;
        }
      } else {
        // CASE B: Non-Telescopic (Flat rate for TOTAL units)
        let flatRate = 9.20; // Default fallback to highest rate
        
        const matchedSlab = nonTelescopic.find(slab => {
          const from = Number(slab.from || 0);
          const to = (slab.to === null) ? Infinity : Number(slab.to);
          return units >= from && units <= to;
        });

        if (matchedSlab) {
          flatRate = Number(matchedSlab.rate);
        }
        
        cost = units * flatRate;
      }
    } 
    // --- TAMIL NADU / PROGRESSIVE LOGIC (UNTOUCHED PERFECT) ---
    else {
      let remaining = units;
      const slabsArray = Array.isArray(slabs) ? slabs : [];
      const sortedSlabs = [...slabsArray].sort((a, b) => a.from - b.from);

      for (const slab of sortedSlabs) {
        if (remaining <= 0) break;
        const slabStart = Number(slab.from || 0);
        const slabEnd = (slab.to === null) ? Infinity : Number(slab.to);
        const slabCapacity = (slabEnd - slabStart + 1);
        const slabUnits = Math.min(remaining, slabCapacity);

        if (slabUnits > 0) {
          cost += slabUnits * Number(slab.rate);
          remaining -= slabUnits;
        }
      }
    }

    // Add fixed charges (Using the structure from your seed function)
    const fixedCharge = tariffTemplate.fixedCharges?.single_phase?.up_to_250 || 0; 
    cost += Number(fixedCharge);

    return Number(cost.toFixed(2));
  }
}

export default SolarExportCalculator;