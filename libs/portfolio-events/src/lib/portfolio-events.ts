export const IN_PORTFOLIO_MANAGER_TOPIC = "in-portfolio-manager";
export const OUT_PORTFOLIO_MANAGER_TOPIC = "out-portfolio-manager";

export const enum PortfolioManagerInEvents {
    BUILD_PORTFOLIO = "in-portfolio-manager.build-portfolio",
    BUILD_PORTFOLIOS = "in-portfolio-manager.build-portfolios",
    BUILD_USER_PORTFOLIO = "in-portfolio-manager.build-user-portfolio",
    BUILD_USER_PORTFOLIOS = "in-portfolio-manager.build-user-portfolios"
}

export const enum PortfolioManagerOutEvents {
    PORTFOLIO_BUILDED = "out-portfolio-manager.portfolio-builded",
    USER_PORTFOLIO_BUILDED = "out-portfolio-manager.user-portfolio-builded",
    PORTFOLIO_BUILD_ERROR = "out-portfolio-manager.portfolio-build-error",
    USER_PORTFOLIO_BUILD_ERROR = "out-portfolio-manager.user-portfolio-build-error"
}

export const PortfolioManagerInSchema = {
    [PortfolioManagerInEvents.BUILD_PORTFOLIO]: {
        portfolioId: "uuid",
        saveSteps: { type: "boolean", optional: true }
    },
    [PortfolioManagerInEvents.BUILD_PORTFOLIOS]: {
        exchange: "string"
    },
    [PortfolioManagerInEvents.BUILD_USER_PORTFOLIO]: {
        userPortfolioId: "uuid"
    }
};

export const PortfolioManagerOutSchema = {
    [PortfolioManagerOutEvents.PORTFOLIO_BUILDED]: {
        portfolioId: "uuid"
    },
    [PortfolioManagerOutEvents.USER_PORTFOLIO_BUILDED]: {
        userPortfolioId: "uuid"
    },
    [PortfolioManagerOutEvents.PORTFOLIO_BUILD_ERROR]: {
        portfolioId: "uuid",
        error: "string"
    },
    [PortfolioManagerOutEvents.USER_PORTFOLIO_BUILD_ERROR]: {
        userPortfolioId: "uuid",
        error: "string"
    }
};

export interface PortfolioManagerBuildPortfolio {
    portfolioId: string;
    saveSteps?: boolean;
}

export interface PotrfolioManagerBuildPortfolios {
    exchange: string;
}

export interface PortfolioManagerBuildUserPortfolio {
    userPortfolioId: string;
}

export interface PortfolioManagerPortfolioBuilded {
    portfolioId: string;
}

export interface PortfolioManagerUserPortfolioBuilded {
    userPortfolioId: string;
}

export interface PortfolioManagerPortfolioBuildError {
    portfolioId: string;
    error: string;
}

export interface PortfolioManagerUserPortfolioBuildError {
    userPortfolioId: string;
    error: string;
}
