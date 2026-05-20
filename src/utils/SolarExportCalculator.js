class SolarExportCalculator {
  static calculateMonthlyCredit(units, tariffTemplate, monthKey) {
    if (!units || units <= 0) return 0;
    if (!tariffTemplate) return 0;

    const state = (tariffTemplate._id || 'tamil-nadu').toLowerCase();
    let cost = 0;
    let selectedSlabs = null;

    // --- NEW DATE-BASED AND CONDITIONAL PROGRESSIVE LOGIC (TAMIL NADU) ---
    if (tariffTemplate.type === "date_based_progressive" && Array.isArray(tariffTemplate.billingRules)) {
      
      // Find the rule matching the timeline era and condition layout
      const matchedRule = tariffTemplate.billingRules.find(rule => {
        // Check timeline bound rules
        if (rule.effectiveTo && monthKey > rule.effectiveTo) return false;
        if (rule.effectiveFrom && monthKey < rule.effectiveFrom) return false;

        // Check conditional max/min units rules
        if (rule.condition) {
          if (rule.condition.maxUnits && units > rule.condition.maxUnits) return false;
          if (rule.condition.minUnits && units < rule.condition.minUnits) return false;
        }

        return true;
      });

      if (matchedRule) {
        selectedSlabs = matchedRule.slabs;
        console.log(`🎯 [Tariff Engine]: Matched rule tier type "${matchedRule.type}" for ${state} in ${monthKey} with ${units} units.`);
      }
    }

    // --- KERALA LOGIC ---
    if (state === 'kerala') {
      const slabs = tariffTemplate.slabs;
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
    // --- STANDARD / FALLBACK PROGRESSIVE LOGIC ---
    else {
      // Use matched slabs from billingRules if found; otherwise fall back to old baseline root slabs array
      const slabsArray = selectedSlabs || tariffTemplate.slabs || [];
      const sortedSlabs = [...slabsArray].sort((a, b) => a.from - b.from);
      let remaining = units;

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