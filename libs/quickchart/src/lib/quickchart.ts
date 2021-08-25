import QuickChart from "quickchart-js";
import * as ChartJS from "chart.js";
import { PerformanceVals } from "@cryptuoso/trade-stats";

export function getChartUrl(config: any, width = 500, height = 300, backgroundColor = "transparent"): string {
    const qc = new QuickChart();

    qc.setConfig(config);
    qc.setWidth(width).setHeight(height).setBackgroundColor(backgroundColor);

    return qc.getUrl().replace("quickchart.io", "api.dev.cryptuoso.com/qc");
}

export function getEquityChartUrl(data: PerformanceVals) {
    const positiveColor = "#69DACD";
    const negativeColor = "#CD3E60";

    return getChartUrl({
        type: "line",
        data: {
            datasets: [
                {
                    data
                    /* fill: {
                        target: { value: 0 },
                        above: positiveColor, // Area will be red above the origin
                        below: negativeColor // And blue below the origin
                    }*/
                }
            ]
        },
        options: {
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                xAxes: [
                    {
                        type: "time"
                    }
                ],
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}
