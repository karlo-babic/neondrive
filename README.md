The maps for each city are downloaded from [https://overpass-turbo.eu/](https://overpass-turbo.eu/) with this command:
```
[out:json];
(
  way["highway"]
     ["highway"!~"footway|cycleway|path|service|track|steps|pedestrian"]
     ({{bbox}});
);
out body;
>;
out skel qt;
```
