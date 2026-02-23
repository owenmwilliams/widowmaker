import { computed } from 'vue';

export interface LocationFormValues {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat: number | null;
  lng: number | null;
}

type FormAccessor = () => LocationFormValues;

export function useLocationForm(getForm: FormAccessor) {
  const manualAddressComplete = computed(() => {
    const form = getForm();
    return Boolean(
      form.address1?.trim() &&
      form.city?.trim() &&
      form.state?.trim() &&
      form.zip?.trim()
    );
  });

  const hasCoordinates = computed(() => {
    const form = getForm();
    return form.lat != null && form.lng != null;
  });

  const ensureCoordinates = async (geocodeFn?: () => Promise<void>) => {
    if (hasCoordinates.value) return true;
    if (!geocodeFn) return false;
    await geocodeFn();
    return hasCoordinates.value;
  };

  return {
    manualAddressComplete,
    hasCoordinates,
    ensureCoordinates
  };
}
