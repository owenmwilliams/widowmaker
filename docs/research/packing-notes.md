### Packing Algorithm Notes

Optimal 3D bin packing is NP-hard, so production systems typically rely on heuristics. For moving/box scenarios, we surveyed common approaches:

1. **First Fit Decreasing (FFD)** – Sort items by largest dimension/volume, then place each into the first box layer that can accept it. Cheap to compute and proven to be within 11/9 of optimal for 1D bin packing.
2. **Best Fit Decreasing (BFD)** – Similar to FFD but chooses the container that leaves the least remaining space after placement. Works well when containers share the same size.
3. **Shelf/Layer heuristics** – Partition each box into horizontal layers and run 2D packing inside each layer. Useful when items are mostly rectangular.
4. **Genetic / Simulated Annealing** – Higher accuracy but usually overkill for live UI feedback.

Our current `evaluatePackingFit` helper (see `src/utils/packing.ts`) implements a simplified FFD-inspired feasibility check: it compares aggregate weight, volume (in cubic feet), and the largest item dimension against a container’s internal dimensions. This gives immediate feedback in the UI while leaving room to plug in a more sophisticated heuristic later.
