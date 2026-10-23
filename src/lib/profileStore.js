// Maps between the `details` object used by the pages and API (camelCase,
// shaped like the profile form) and the Supabase tables profiles and
// donor_screening (snake_case).

export function rowsToDetails(profile, screening) {
  if (!profile) return null;
  return {
    fullName: profile.full_name ?? "",
    dob: profile.dob ?? null,
    gender: profile.gender ?? null,
    phone: profile.phone ?? "",
    stateCode: profile.state_code ?? null,
    districtCode: profile.district_code ?? null,
    emergencyContact: {
      name: profile.emergency_name ?? null,
      phone: profile.emergency_phone ?? null,
    },
    isDonor: profile.is_donor === true,
    bloodGroupId: profile.blood_group_code ?? "",
    donorDetails:
      profile.is_donor && screening
        ? {
            lastDonationDate: screening.last_donation_date ?? null,
            donationCamp: screening.donation_camp ?? null,
            recentTattoo: screening.recent_tattoo === true,
            pregnant: screening.pregnant === true,
            underweight: screening.underweight === true,
            onMedication: screening.on_medication === true,
            medicationDetails: screening.medication_details ?? null,
            hasDisease: screening.has_disease === true,
          }
        : null,
  };
}

// `details` must already be validated by sanitizeDetails().
export function detailsToRows(details) {
  const profile = {
    full_name: details.fullName,
    dob: details.dob,
    gender: details.gender,
    phone: details.phone,
    state_code: details.stateCode,
    district_code: details.districtCode,
    emergency_name: details.emergencyContact?.name ?? null,
    emergency_phone: details.emergencyContact?.phone ?? null,
    blood_group_code: details.bloodGroupId,
    is_donor: details.isDonor,
  };
  const donorDetails = details.donorDetails;
  const screening = donorDetails
    ? {
        last_donation_date: donorDetails.lastDonationDate,
        donation_camp: donorDetails.donationCamp,
        recent_tattoo: donorDetails.recentTattoo,
        pregnant: donorDetails.pregnant,
        underweight: donorDetails.underweight,
        on_medication: donorDetails.onMedication,
        medication_details: donorDetails.medicationDetails,
        has_disease: donorDetails.hasDisease,
      }
    : null;
  return { profile, screening };
}
