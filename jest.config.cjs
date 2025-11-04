module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            useESM: true
        }],
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/main.ts'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    moduleNameMapper: {
        '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
        '^marked$': '<rootDir>/tests/__mocks__/marked.ts',
        '^turndown$': '<rootDir>/tests/__mocks__/turndown.ts'
    },
    extensionsToTreatAsEsm: ['.ts'],
    transformIgnorePatterns: [
        'node_modules/(?!(marked|turndown|turndown-plugin-gfm)/)'
    ]
};