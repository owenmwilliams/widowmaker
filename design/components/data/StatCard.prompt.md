A dashboard metric tile: tinted icon chip, big value, label, optional sublabel. Used across the inventory dashboard.

```jsx
<StatCard icon={<BoxIcon/>} value="281" label="Items" sublabel="Total inventory items" />
<StatCard icon={<ScaleIcon/>} value="6,098.5 lbs" label="Total Weight" sublabel="281/281 items tracked" tone="cyan" />
<StatCard icon={<AlertIcon/>} value="99" label="Fragile Items" sublabel="Handle with care" tone="warning" />
```
