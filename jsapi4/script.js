var view;
require([
    'esri/Map',
    'esri/views/SceneView',
    'esri/layers/GraphicsLayer',
    'esri/layers/FeatureLayer',
    'esri/geometry/geometryEngine',
    'esri/geometry/geometryEngineAsync',
    'esri/geometry/Polyline',
    'esri/geometry/Point',
    'esri/Graphic',
    'esri/symbols/SimpleLineSymbol',
    'esri/symbols/SimpleMarkerSymbol',
    'dojo/domReady!'
], function(
    Map, SceneView, GraphicsLayer, FeatureLayer, geometryEngine, geometryEngineAsync, Polyline, Point, Graphic, SimpleLineSymbol, SimpleMarkerSymbol
) {
    var featureLayer = new FeatureLayer({
        url: '//services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Continents/FeatureServer/0'
    });
    featureLayer.then(function(layer) {
        layer.renderer.symbol.color = null;
        layer.renderer.symbol.outline.width = 3;
        layer.renderer.symbol.outline.color = [100, 0, 255];
        layer.generalizeForScale = 1000000;
    });

    var graphicsLayer = new GraphicsLayer();

    var map = new Map({
        basemap: 'dark-gray',
        layers: [featureLayer, graphicsLayer]
    });

    view = new SceneView({
        container: 'viewDiv',
        map: map,
        center: [0, 0],
        zoom: 4.5
    });

    var layerView = null;
    var unionGeom = true; // TODO: return to falsy when/if the uioned geoms are still needed

    view.on('click', function(evt) {
        checkLayerView(evt.mapPoint);
    });

    // simulate a view 'mouse-move' listener
    // view.container.addEventListener('mousemove', handleMouseMove);

    function handleMouseMove(mouseEvt) {
        // convert from screen to view coordinates
        view.hitTest(mouseEvt.layerX, mouseEvt.layerY).then(function(evt) {
            // a hitTest appears to fire on a 'click' as well

            /*if (evt.graphic) {
                console.log(evt);
            }*/

            if (evt.mapPoint) {
                checkLayerView(evt.mapPoint);
            }
        });
    }

    // github.com/chrisveness/geodesy
    function calculateGeodesyMethod(esriPointA, esriPointB, geodesyMethodName) {
        var geodesyPointA = new LatLon(esriPointA.latitude, esriPointA.longitude);
        var geodesyPointB = new LatLon(esriPointB.latitude, esriPointB.longitude);
        return geodesyPointA[geodesyMethodName](geodesyPointB);
    }

    function checkLayerView(mapPoint) {
        // establish the layerView (once) before attempting to do any analysis
        if (!layerView) {
            view.getLayerView(featureLayer).then(function(layerViewResults) {
                layerView = layerViewResults;
                checkAnalysisDependencies(layerView, mapPoint);
            });
        } else {
            checkAnalysisDependencies(layerView, mapPoint);
        }
    }

    function checkAnalysisDependencies(layerView, mapPoint) {
        var canvas3DGraphics = layerView.getCanvas3DGraphics();

        var geoms = Object.keys(canvas3DGraphics).map(function(key) {
            return canvas3DGraphics[key].graphic.geometry;
        });

        if (!unionGeom) {
            unionGeom = geometryEngineAsync.union(geoms).then(function(geoms) {
                unionGeom = geoms;

                console.info('union preprocessing complete');

                performAnalysis(canvas3DGraphics, mapPoint, unionGeom);
            });
        } else {
            performAnalysis(canvas3DGraphics, mapPoint, unionGeom);
        }
    }

    function performAnalysis(canvas3DGraphics, mapPoint /*, unionGeom*/ ) {
        var filteredIndices = Object.keys(canvas3DGraphics).filter(function(key) {
            return geometryEngine.intersects(canvas3DGraphics[key].graphic.geometry, mapPoint);
        });

        if (filteredIndices.length) {
            var polygonToSearch = canvas3DGraphics[filteredIndices[0]].graphic.geometry;
            geometryEngineAsync.nearestVertices(polygonToSearch, mapPoint, 500000, 2).then(function(vertexInfos) {

                console.info('nearest coastline vertices found');

                if (vertexInfos.length === 2) {
                    // Sort by vertex index for consistent coastline vertex order.
                    vertexInfos.sort(function(o1, o2) {
                        return o1.vertexIndex - o2.vertexIndex;
                    });

                    var startPoint = vertexInfos[0].coordinate;
                    var endPoint = vertexInfos[1].coordinate;

                    // Use Geodesy lib to calculate the midpoint location.
                    var geodesyMidPoint = calculateGeodesyMethod(startPoint, endPoint, 'midpointTo');

                    // Convert Geodesy result to Esri point geometry.
                    var midPoint = new Point({
                        longitude: geodesyMidPoint.lon,
                        latitude: geodesyMidPoint.lat,
                        spatialReference: startPoint.spatialReference
                    });

                    // Calculate compass bearing from coastline midpoint to end point, and then
                    //  use that value to help determine the perpendicular direction from the coast.
                    var compassBearing = calculateGeodesyMethod(midPoint, endPoint, 'bearingTo') - 90;

                    // Convert the bearing to latitude values constrained to a range of +/-90.
                    var rotationLatitude = 0;

                    // Create a line at the midpoint and wrap it around the Earth.
                    var wrapAroundLine = new Polyline({
                        paths: [
                            [
                                [midPoint.longitude, midPoint.latitude],
                                [midPoint.longitude + 90, rotationLatitude],
                                [midPoint.longitude + 180, -midPoint.latitude],
                                [midPoint.longitude + 270, -rotationLatitude],
                                [midPoint.longitude + 360, midPoint.latitude]
                            ],
                        ],
                        spatialReference: {
                            wkid: 4326
                        }
                    });

                    graphicsLayer.clear();

                    // Geodetically densify the wrap around line.

                    geometryEngineAsync.geodesicDensify(wrapAroundLine, 10000).then(function(gdLine) {
                        graphicsLayer.add(new Graphic({
                            geometry: wrapAroundLine,
                            symbol: new SimpleLineSymbol({
                                color: [255, 255, 100],
                                width: 6
                            })
                        }));

                        graphicsLayer.add(new Graphic({
                            geometry: gdLine,
                            symbol: new SimpleLineSymbol({
                                color: [200, 200, 200],
                                width: 6
                            })
                        }));

                        graphicsLayer.add(new Graphic({
                            geometry: startPoint,
                            symbol: new SimpleMarkerSymbol({
                                color: [255, 0, 0]
                            })
                        }));

                        graphicsLayer.add(new Graphic({
                            geometry: midPoint,
                            symbol: new SimpleMarkerSymbol({
                                color: [255, 255, 0]
                            })
                        }));

                        graphicsLayer.add(new Graphic({
                            geometry: endPoint,
                            symbol: new SimpleMarkerSymbol({
                                color: [0, 255, 0]
                            })
                        }));

                        return;

                        // Split the wrapped around and rotated line by any intersecting continents.
                        geometryEngineAsync.difference(rotatedLine, unionGeom).then(function(leftoversGeom) {

                            console.info('line differencing complete');

                            // Only keep the first difference line segment,
                            //  which whould be the path across the ocean to the opposing coast.
                            leftoversGeom.paths = [leftoversGeom.paths[0]];

                            graphicsLayer.add(new Graphic({
                                geometry: leftoversGeom,
                                symbol: new SimpleLineSymbol({
                                    color: [200, 0, 200],
                                    width: 6
                                })
                            }));

                            graphicsLayer.add(new Graphic({
                                geometry: leftoversGeom.getPoint(0, leftoversGeom.paths[0].length - 1),
                                symbol: new SimpleMarkerSymbol({
                                    color: [200, 0, 200]
                                })
                            }));

                            // graphicsLayer.remove(gdLineGraphic);
                        });

                    });
                }

            });

        }

    }

});