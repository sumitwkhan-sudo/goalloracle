// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title GoalOracleVerifier
 * @notice Multi-source oracle for World Cup match result verification.
 *         Results must be confirmed by at least 2 independent oracles
 *         before any payout can occur. Supports extra time + penalties.
 *
 * Architecture:
 *   - Admin registers trusted oracle addresses (e.g. Chainlink, API3, custom)
 *   - Each oracle submits match results independently
 *   - When `requiredConfirmations` (default 2) oracles agree on the same
 *     result hash, the result is marked as VERIFIED
 *   - Only verified results can trigger prize distribution
 *   - Dispute window allows admin to freeze payouts if oracles conflict
 */
contract GoalOracleVerifier is Ownable, ReentrancyGuard {

    // ─── Structs ────────────────────────────────────────────────
    struct MatchResult {
        uint8  homeScore;
        uint8  awayScore;
        bool   extraTime;
        bool   penalties;
        uint8  penHome;      // penalty shootout score (if applicable)
        uint8  penAway;
        uint8  confirmations; // how many oracles agree
        bool   verified;      // true once threshold met
        bool   disputed;      // admin can freeze if conflict
        uint256 verifiedAt;   // timestamp of verification
    }

    struct OracleSubmission {
        uint8  homeScore;
        uint8  awayScore;
        bool   extraTime;
        bool   penalties;
        uint8  penHome;
        uint8  penAway;
        uint256 submittedAt;
    }

    // ─── State ──────────────────────────────────────────────────
    uint8 public requiredConfirmations = 2;
    uint256 public disputeWindow = 1 hours; // time after verification before payout allowed

    mapping(address => bool) public trustedOracles;
    address[] public oracleList;

    // matchId => MatchResult
    mapping(string => MatchResult) public matchResults;

    // matchId => oracle address => submission
    mapping(string => mapping(address => OracleSubmission)) public submissions;

    // matchId => resultHash => count of agreeing oracles
    mapping(string => mapping(bytes32 => uint8)) public hashConfirmations;

    // matchId => resultHash => list of oracles that submitted this hash
    mapping(string => mapping(bytes32 => address[])) public hashOracles;

    // ─── Events ─────────────────────────────────────────────────
    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event ResultSubmitted(string indexed matchId, address indexed oracle, bytes32 resultHash);
    event ResultVerified(string indexed matchId, uint8 homeScore, uint8 awayScore, bool extraTime, bool penalties);
    event ResultDisputed(string indexed matchId, address indexed by);
    event DisputeResolved(string indexed matchId);
    event ConfirmationsUpdated(uint8 newRequired);

    // ─── Modifiers ──────────────────────────────────────────────
    modifier onlyOracle() {
        require(trustedOracles[msg.sender], "Not a trusted oracle");
        _;
    }

    modifier notVerified(string calldata matchId) {
        require(!matchResults[matchId].verified, "Already verified");
        _;
    }

    // ─── Constructor ────────────────────────────────────────────
    constructor() Ownable(msg.sender) {}

    // ─── Oracle Management ──────────────────────────────────────
    function addOracle(address oracle) external onlyOwner {
        require(!trustedOracles[oracle], "Already trusted");
        trustedOracles[oracle] = true;
        oracleList.push(oracle);
        emit OracleAdded(oracle);
    }

    function removeOracle(address oracle) external onlyOwner {
        require(trustedOracles[oracle], "Not an oracle");
        trustedOracles[oracle] = false;
        emit OracleRemoved(oracle);
    }

    function setRequiredConfirmations(uint8 _required) external onlyOwner {
        require(_required >= 2, "Minimum 2 confirmations");
        require(_required <= oracleList.length, "Not enough oracles");
        requiredConfirmations = _required;
        emit ConfirmationsUpdated(_required);
    }

    function setDisputeWindow(uint256 _window) external onlyOwner {
        disputeWindow = _window;
    }

    // ─── Result Submission ──────────────────────────────────────
    /**
     * @notice Oracle submits a match result. If enough oracles agree,
     *         the result becomes verified.
     */
    function submitResult(
        string calldata matchId,
        uint8 homeScore,
        uint8 awayScore,
        bool extraTime,
        bool penalties,
        uint8 penHome,
        uint8 penAway
    ) external onlyOracle notVerified(matchId) {
        // Prevent double submission
        require(
            submissions[matchId][msg.sender].submittedAt == 0,
            "Already submitted"
        );

        // Store individual submission
        submissions[matchId][msg.sender] = OracleSubmission({
            homeScore: homeScore,
            awayScore: awayScore,
            extraTime: extraTime,
            penalties: penalties,
            penHome: penHome,
            penAway: penAway,
            submittedAt: block.timestamp
        });

        // Compute result hash (same result from different oracles = same hash)
        bytes32 rHash = keccak256(abi.encodePacked(
            homeScore, awayScore, extraTime, penalties, penHome, penAway
        ));

        hashConfirmations[matchId][rHash]++;
        hashOracles[matchId][rHash].push(msg.sender);

        emit ResultSubmitted(matchId, msg.sender, rHash);

        // Check if threshold is met
        if (hashConfirmations[matchId][rHash] >= requiredConfirmations) {
            matchResults[matchId] = MatchResult({
                homeScore: homeScore,
                awayScore: awayScore,
                extraTime: extraTime,
                penalties: penalties,
                penHome: penHome,
                penAway: penAway,
                confirmations: hashConfirmations[matchId][rHash],
                verified: true,
                disputed: false,
                verifiedAt: block.timestamp
            });

            emit ResultVerified(matchId, homeScore, awayScore, extraTime, penalties);
        }
    }

    // ─── Dispute Handling ───────────────────────────────────────
    /**
     * @notice Admin can dispute a result if oracles conflict
     */
    function disputeResult(string calldata matchId) external onlyOwner {
        require(matchResults[matchId].verified, "Not verified");
        matchResults[matchId].disputed = true;
        emit ResultDisputed(matchId, msg.sender);
    }

    function resolveDispute(string calldata matchId) external onlyOwner {
        require(matchResults[matchId].disputed, "Not disputed");
        matchResults[matchId].disputed = false;
        emit DisputeResolved(matchId);
    }

    /**
     * @notice Override result in case of oracle error (admin only, disputed matches only)
     */
    function overrideResult(
        string calldata matchId,
        uint8 homeScore,
        uint8 awayScore,
        bool extraTime,
        bool penalties,
        uint8 penHome,
        uint8 penAway
    ) external onlyOwner {
        require(matchResults[matchId].disputed, "Must be disputed first");

        matchResults[matchId] = MatchResult({
            homeScore: homeScore,
            awayScore: awayScore,
            extraTime: extraTime,
            penalties: penalties,
            penHome: penHome,
            penAway: penAway,
            confirmations: requiredConfirmations,
            verified: true,
            disputed: false,
            verifiedAt: block.timestamp
        });

        emit ResultVerified(matchId, homeScore, awayScore, extraTime, penalties);
    }

    // ─── View Functions ─────────────────────────────────────────
    /**
     * @notice Check if a result is ready for payout
     *         (verified + not disputed + past dispute window)
     */
    function isPayoutReady(string calldata matchId) external view returns (bool) {
        MatchResult memory r = matchResults[matchId];
        return r.verified
            && !r.disputed
            && block.timestamp >= r.verifiedAt + disputeWindow;
    }

    function getResult(string calldata matchId)
        external view
        returns (uint8, uint8, bool, bool, uint8, uint8, bool, bool)
    {
        MatchResult memory r = matchResults[matchId];
        return (
            r.homeScore, r.awayScore,
            r.extraTime, r.penalties,
            r.penHome, r.penAway,
            r.verified, r.disputed
        );
    }

    function getOracleSubmission(string calldata matchId, address oracle)
        external view
        returns (uint8, uint8, bool, bool, uint8, uint8, uint256)
    {
        OracleSubmission memory s = submissions[matchId][oracle];
        return (
            s.homeScore, s.awayScore,
            s.extraTime, s.penalties,
            s.penHome, s.penAway,
            s.submittedAt
        );
    }

    function getOracleCount() external view returns (uint256) {
        return oracleList.length;
    }
}
