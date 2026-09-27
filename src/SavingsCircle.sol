// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Permissionless, fully bonded rotating savings circles denominated in CIRC.
/// @dev Round deadlines are independent of when rounds are closed. All credits are pulled by their owner.
contract SavingsCircle is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_CONTRIBUTION = 1 ether;
    uint256 public constant MIN_ROUND_LENGTH = 1 hours;
    uint256 public constant MAX_ROUND_LENGTH = 30 days;
    uint256 public constant JOIN_PERIOD = 7 days;

    enum State {
        Recruiting,
        Active,
        Cancelled,
        Finalized
    }

    struct Circle {
        uint256 contribution;
        uint256 roundLength;
        uint256 seats;
        uint256 joined;
        uint256 createdAt;
        uint256 start;
        uint256 nextRound;
        uint256 bondsHeld;
        uint256 openPots;
        uint256 carry;
        State state;
    }

    IERC20 public immutable token;
    uint256 public circleCount;
    uint256 public totalBonds;
    uint256 public totalOpenPots;
    uint256 public totalCarry;
    uint256 public totalWithdrawable;

    mapping(address account => uint256 amount) public withdrawable;
    mapping(uint256 id => Circle) private _circles;
    mapping(uint256 id => mapping(uint256 seat => address account)) private _members;
    mapping(uint256 id => mapping(address account => uint256 seatPlusOne)) private _seat;
    mapping(uint256 id => mapping(address account => uint256 bitmap)) private _paidRounds;
    mapping(uint256 id => mapping(uint256 round => uint256 amount)) private _pots;

    error InvalidToken();
    error InvalidContribution();
    error InvalidRoundLength();
    error InvalidSeats();
    error UnknownCircle();
    error WrongState();
    error JoinExpired();
    error AlreadyMember();
    error NotMember();
    error InvalidSeat();
    error InvalidRound();
    error CancellationTooEarly();
    error RoundWindowEnded();
    error MemberInDefault();
    error AlreadyContributed();
    error RoundOutOfOrder();
    error RoundNotEnded();
    error NothingToWithdraw();
    error UnexpectedTransferAmount();

    event Created(
        uint256 indexed id, address indexed creator, uint256 contribution, uint256 roundLength, uint256 seats
    );
    event Joined(uint256 indexed id, address indexed member, uint256 seat);
    event Cancelled(uint256 indexed id);
    event Contributed(uint256 indexed id, uint256 indexed round, address indexed member);
    event RoundClosed(uint256 indexed id, uint256 indexed round, address indexed recipient, uint256 pot, bool carried);
    event Finalized(uint256 indexed id);
    event Withdrawn(address indexed member, uint256 amount);

    /// @param token_ The launch token address, passed by the factory as $token. No initial balance is needed.
    constructor(address token_) {
        if (token_ == address(0) || token_.code.length == 0) revert InvalidToken();
        token = IERC20(token_);
    }

    /// @notice Create a circle and take seat zero by depositing (seats - 1) contributions as a bond.
    function create(uint256 contribution, uint256 roundLength, uint256 seats)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (seats < 2 || seats > 10) revert InvalidSeats();
        if (contribution < MIN_CONTRIBUTION || contribution > type(uint256).max / (seats - 1)) {
            revert InvalidContribution();
        }
        if (roundLength < MIN_ROUND_LENGTH || roundLength > MAX_ROUND_LENGTH) revert InvalidRoundLength();

        id = circleCount++;
        Circle storage c = _circles[id];
        c.contribution = contribution;
        c.roundLength = roundLength;
        c.seats = seats;
        c.createdAt = block.timestamp;
        emit Created(id, msg.sender, contribution, roundLength, seats);
        _join(id, c);
    }

    /// @notice Take the next seat before the seven-day deadline, depositing the full bond.
    function join(uint256 id) external nonReentrant {
        Circle storage c = _getCircle(id);
        if (c.state != State.Recruiting) revert WrongState();
        if (block.timestamp >= c.createdAt + JOIN_PERIOD) revert JoinExpired();
        if (_seat[id][msg.sender] != 0) revert AlreadyMember();
        _join(id, c);
    }

    /// @notice Anyone may cancel an unfilled circle at or after the seven-day deadline.
    function cancel(uint256 id) external nonReentrant {
        Circle storage c = _getCircle(id);
        if (c.state != State.Recruiting) revert WrongState();
        if (block.timestamp < c.createdAt + JOIN_PERIOD) revert CancellationTooEarly();
        c.state = State.Cancelled;
        uint256 bond = (c.seats - 1) * c.contribution;
        totalBonds -= c.bondsHeld;
        c.bondsHeld = 0;
        for (uint256 seat; seat < c.joined; ++seat) {
            _credit(_members[id][seat], bond);
        }
        emit Cancelled(id);
    }

    /// @notice Pay exactly once in the current time window; missing any earlier window is permanent default.
    function contribute(uint256 id) external nonReentrant {
        Circle storage c = _getCircle(id);
        if (c.state != State.Active) revert WrongState();
        if (_seat[id][msg.sender] == 0) revert NotMember();
        uint256 round = (block.timestamp - c.start) / c.roundLength;
        if (round >= c.seats) revert RoundWindowEnded();
        uint256 paid = _paidRounds[id][msg.sender];
        uint256 prior = (1 << round) - 1;
        if (paid & prior != prior) revert MemberInDefault();
        uint256 bit = 1 << round;
        if (paid & bit != 0) revert AlreadyContributed();

        _paidRounds[id][msg.sender] = paid | bit;
        _pots[id][round] += c.contribution;
        c.openPots += c.contribution;
        totalOpenPots += c.contribution;
        emit Contributed(id, round, msg.sender);
        _pull(c.contribution);
    }

    /// @notice Close an ended round in order. Closing the last round also settles bonds and final carry.
    function closeRound(uint256 id, uint256 round) external nonReentrant {
        Circle storage c = _getCircle(id);
        if (c.state != State.Active) revert WrongState();
        if (round != c.nextRound) revert RoundOutOfOrder();
        if (block.timestamp < c.start + (round + 1) * c.roundLength) revert RoundNotEnded();

        uint256 contributions = _pots[id][round];
        uint256 pot = contributions + c.carry;
        c.openPots -= contributions;
        totalOpenPots -= contributions;
        delete _pots[id][round];
        totalCarry -= c.carry;
        c.carry = 0;
        c.nextRound = round + 1;

        address recipient = _members[id][round];
        uint256 required = (1 << (round + 1)) - 1;
        bool carried = _paidRounds[id][recipient] & required != required;
        if (carried) {
            c.carry = pot;
            totalCarry += pot;
            recipient = address(0);
        } else {
            _credit(recipient, pot);
        }
        emit RoundClosed(id, round, recipient, pot, carried);
        if (c.nextRound == c.seats) _finalize(id, c);
    }

    /// @notice Collect all caller-owned credits across all circles. Failed transfers preserve the credit.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        emit Withdrawn(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    function circle(uint256 id) external view returns (Circle memory) {
        return _getCircle(id);
    }

    function member(uint256 id, uint256 seat) external view returns (address) {
        Circle storage c = _getCircle(id);
        if (seat >= c.joined) revert InvalidSeat();
        return _members[id][seat];
    }

    /// @notice True as soon as any ended round was missed, independent of closeRound calls.
    /// @dev Nonmembers and members of circles that never started are not in default.
    function inDefault(uint256 id, address account) external view returns (bool) {
        Circle storage c = _getCircle(id);
        if (_seat[id][account] == 0 || c.state == State.Recruiting || c.state == State.Cancelled) return false;
        uint256 ended = _elapsedRounds(c);
        uint256 required = (1 << ended) - 1;
        return _paidRounds[id][account] & required != required;
    }

    /// @notice Zero before activation; 0..seats-1 during windows; seats once all windows have ended.
    /// @dev Check circle.state to distinguish a recruiting/cancelled circle from an active round zero.
    function currentRound(uint256 id) external view returns (uint256) {
        Circle storage c = _getCircle(id);
        if (c.state == State.Recruiting || c.state == State.Cancelled) return 0;
        return _elapsedRounds(c);
    }

    /// @notice Contribution history remains available after rounds close (bit r corresponds to round r).
    function paidRounds(uint256 id, address account) external view returns (uint256) {
        _getCircle(id);
        return _paidRounds[id][account];
    }

    /// @notice Contributions in an unclosed round, excluding carry. Returns zero for a closed round.
    function roundPot(uint256 id, uint256 round) external view returns (uint256) {
        Circle storage c = _getCircle(id);
        if (round >= c.seats) revert InvalidRound();
        return _pots[id][round];
    }

    function accountedBalance() external view returns (uint256) {
        return totalBonds + totalOpenPots + totalCarry + totalWithdrawable;
    }

    function _getCircle(uint256 id) private view returns (Circle storage c) {
        if (id >= circleCount) revert UnknownCircle();
        return _circles[id];
    }

    function _elapsedRounds(Circle storage c) private view returns (uint256) {
        uint256 elapsed = (block.timestamp - c.start) / c.roundLength;
        return elapsed < c.seats ? elapsed : c.seats;
    }

    function _join(uint256 id, Circle storage c) private {
        uint256 seat = c.joined++;
        _seat[id][msg.sender] = seat + 1;
        _members[id][seat] = msg.sender;
        uint256 bond = (c.seats - 1) * c.contribution;
        c.bondsHeld += bond;
        totalBonds += bond;
        if (c.joined == c.seats) {
            c.state = State.Active;
            c.start = block.timestamp;
        }
        emit Joined(id, msg.sender, seat);
        _pull(bond);
    }

    function _pull(uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert UnexpectedTransferAmount();
    }

    function _credit(address account, uint256 amount) private {
        withdrawable[account] += amount;
        totalWithdrawable += amount;
    }

    function _finalize(uint256 id, Circle storage c) private {
        c.state = State.Finalized;
        uint256 required = (1 << c.seats) - 1;
        uint256 goodMask;
        uint256 everMask;
        uint256 goodCount;
        uint256 everCount;
        uint256 bond = (c.seats - 1) * c.contribution;
        uint256 pool = c.bondsHeld + c.carry;
        totalBonds -= c.bondsHeld;
        totalCarry -= c.carry;
        c.bondsHeld = 0;
        c.carry = 0;

        for (uint256 seat; seat < c.seats; ++seat) {
            address account = _members[id][seat];
            uint256 paid = _paidRounds[id][account];
            if (paid == required) {
                goodMask |= 1 << seat;
                ++goodCount;
                pool -= bond;
                _credit(account, bond);
            }
            if (paid != 0) {
                everMask |= 1 << seat;
                ++everCount;
            }
        }

        if (everCount == 0) {
            // There can be no contributions or carry in this branch: all bonds are returned intact.
            for (uint256 seat; seat < c.seats; ++seat) {
                _credit(_members[id][seat], bond);
            }
        } else {
            uint256 eligible = goodCount != 0 ? goodMask : everMask;
            uint256 count = goodCount != 0 ? goodCount : everCount;
            _distribute(id, c.seats, eligible, count, pool);
        }
        emit Finalized(id);
    }

    function _distribute(uint256 id, uint256 seats, uint256 eligible, uint256 count, uint256 pool) private {
        uint256 share = pool / count;
        uint256 remainder = pool % count;
        for (uint256 seat; seat < seats; ++seat) {
            if (eligible & (1 << seat) != 0) {
                _credit(_members[id][seat], share + remainder);
                remainder = 0;
            }
        }
    }
}
