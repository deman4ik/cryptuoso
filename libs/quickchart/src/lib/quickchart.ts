import QuickChart from "quickchart-js";
import tinyurl from "tinyurl";
import { PerformanceVals } from "@cryptuoso/trade-stats";

export function getChartUrl(config: any, width = 600, height = 300, backgroundColor = "#0C1940"): string {
    const qc = new QuickChart();

    qc.setConfig(config);
    qc.setDevicePixelRatio(2);
    qc.setWidth(width).setHeight(height).setBackgroundColor(backgroundColor);

    return qc.getUrl().replace("quickchart.io", "api.dev.cryptuoso.com/qc");
}

export async function getEquityChartUrl(data: PerformanceVals): Promise<string> {
    const chartUrl = getChartUrl({
        type: "line",
        data: {
            datasets: [
                {
                    data,
                    label: "Equity",
                    backgroundColor: "rgba(0, 255, 252, 0.1)",
                    borderColor: "#00FFFC",
                    borderWidth: 2,
                    pointBackgroundColor: "#00FFFC",
                    pointRadius: 0,
                    lineTension: 0.5
                }
            ]
        },

        options: {
            legend: {
                display: false
                /*labels: {
                    family: "Roboto"
                }*/
            },
            devicePixelRatio: 3,
            interaction: {
                intersect: false
            },

            ticks: {
                fontColor: "white"
            },
            scales: {
                xAxes: [
                    {
                        type: "time",
                        distribution: "linear",
                        gridLines: {
                            display: false,
                            color: "rgba(255, 255, 255, 0.1)",
                            lineWidth: 0.5,
                            zeroLineColor: "rgba(255, 255, 255, 0.2)"
                        },
                        ticks: {
                            fontColor: "rgba(255, 255, 255, 0.5)"
                        }
                    }
                ],
                yAxes: [
                    {
                        position: "right",
                        gridLines: {
                            display: false,
                            color: "rgba(255, 255, 255, 0.1)",
                            lineWidth: 0.5,
                            zeroLineColor: "rgba(255, 255, 255, 0.2)"
                        },
                        ticks: { beginAtZero: true, fontColor: "rgba(255, 255, 255, 0.5)" }
                    }
                ]
            }
        }
    });

    const shortUrl = await tinyurl.shorten(chartUrl);

    return shortUrl;
}
