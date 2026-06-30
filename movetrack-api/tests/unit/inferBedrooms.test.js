'use strict';

const { inferBedroomsFromRoomNames } = require('../../services/inventory/inventoryMaturityService');

describe('inferBedroomsFromRoomNames', () => {
  test('counts numbered bedrooms', () => {
    expect(inferBedroomsFromRoomNames(['Kitchen', 'Bedroom 1', 'Bedroom 2', 'Bathroom'])).toBe(2);
  });

  test('counts master/primary bedrooms', () => {
    expect(inferBedroomsFromRoomNames(['Living Room', 'Master Bedroom', 'Primary Bedroom'])).toBe(2);
  });

  test('is case-insensitive', () => {
    expect(inferBedroomsFromRoomNames(['bedroom', 'BEDROOM'])).toBe(2);
  });

  test('does not count bathrooms or other rooms', () => {
    expect(inferBedroomsFromRoomNames(['Bathroom', 'Kitchen', 'Garage', 'Living Room'])).toBeNull();
  });

  test('returns null when there are no rooms', () => {
    expect(inferBedroomsFromRoomNames([])).toBeNull();
  });

  test('tolerates null/undefined names', () => {
    expect(inferBedroomsFromRoomNames([null, undefined, 'Bedroom 3'])).toBe(1);
  });
});
