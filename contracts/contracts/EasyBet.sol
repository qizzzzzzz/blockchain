// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title EasyBet - 去中心化的竞猜与票据交易（ERC721）合约
/// @author GitHub Copilot
/// @notice 合约支持公证人创建竞猜活动（多个选项），玩家下注获得 ERC721 票据，票据可二级交易，公证人结算并按胜出票据均分奖池。
contract EasyBet is ERC721, Ownable, ReentrancyGuard {
    uint256 private _tokenIds; // 票据 tokenId 计数器（从 0 开始，铸造前自增）
    uint256 private _activityIds; // 活动 id 计数器（从 0 开始，创建前自增）

    // 记录每张票据的信息
    struct Ticket {
        uint256 activityId; // 哪个活动
        uint256 choiceIndex; // 选择的选项索引
        uint256 amount; // 购买金额（wei）
    }

    // 活动结构体
    struct Activity {
        address creator; // 创建者（公证人），通常是合约 owner
        uint256 deadline; // 截止时间（timestamp），在此之前可下注
        string[] choices; // 选项列表
        string content; // 竞猜内容
        uint256 initialPool; // 创建时公证人注入的初始奖池（wei）
        uint256 totalPool; // 当前总奖池（包括玩家下注）
        uint256[] ticketIds; // 参与该活动的所有票据 id（用于结算时遍历）
        bool settled; // 是否已结算
        uint256 winningChoice; // 结算后记录的胜出选项索引
        uint256[] choiceBetAmounts; // 每个选项累计的下注金额（wei）
    }

    // 二级市场挂单信息
    struct Listing {
        address seller;
        uint256 price; // in wei
        bool exists;
    }

    // mappings
    mapping(uint256 => Activity) public activities; // activityId => Activity
    mapping(uint256 => Ticket) public tickets; // tokenId => Ticket
    mapping(uint256 => Listing) public listings; // tokenId => Listing

    // 维护持有人 -> tokenId 列表，便于前端查询用户的票据
    mapping(address => uint256[]) private _ownerTickets;
    // tokenId -> 在_ownerTickets[array] 中的位置（index），存储 index + 1（0 表示不存在）
    mapping(uint256 => uint256) private _ownerTicketIndex;

    // 事件

    // 用户下注，生成一张票（NFT）
    event BetPlaced(
        uint256 indexed tokenId, // 新铸造的票据 NFT ID
        uint256 indexed activityId, // 所属活动 ID
        uint256 price, // 下注金额
        address indexed owner // 用户地址
    );

    // 创建新的竞猜活动
    event ActivityCreated(
        uint256 indexed activityId, // 活动 ID
        uint256 initialPool, // 初始奖池金额
        uint256 deadline // 截止下注时间
    );

    // 用户将票上架转售（挂单）
    event TicketListed(
        uint256 indexed tokenId, // 上架的票据 ID
        address indexed seller, // 卖家地址
        uint256 price // 出售价
    );

    // 用户取消票的挂单
    event TicketListingCanceled(
        uint256 indexed tokenId, // 票据 ID
        address indexed seller // 卖家地址
    );

    // 票被二手市场购买
    event TicketSold(
        uint256 indexed tokenId, // 票据 ID
        address indexed seller, // 卖家
        address indexed buyer, // 买家
        uint256 price // 二手出售价格
    );

    // 活动结算
    event ActivitySettled(
        uint256 indexed activityId, // 活动 ID
        uint256 winningChoice, // 获胜选项
        uint256 winnersCount, // 获胜票数
        uint256 totalPool // 最终奖池
    );

    // 将初始 owner 传给 OpenZeppelin v5 的 Ownable 基类
    constructor() ERC721("EasyBetTicket", "EBT") Ownable(msg.sender) {
        // 构造函数，ERC721 名称与简称，Ownable 初始化为部署者
    }

    // ========== 活动管理（仅合约 owner / 公证人） ==========

    /// @notice 创建一个竞猜活动，并注入初始奖池（payable）
    /// @param content 竞猜内容
    /// @param choices 选项数组，至少两个选项
    /// @param deadline 截止时间（unix timestamp），必须大于当前时间
    function createActivity(
        string calldata content,
        string[] calldata choices,
        uint256 deadline
    ) external payable onlyOwner returns (uint256) {
        require(bytes(content).length > 0, "Content required");
        require(choices.length >= 2, "At least two options required");
        require(deadline > block.timestamp, "Deadline must be in the future");
        require(msg.value > 0, "Initial pool must be provided");

        // v5: 原生自增
        _activityIds += 1;
        uint256 newActivityId = _activityIds;

        Activity storage a = activities[newActivityId];
        a.creator = msg.sender;
        a.content = content;
        a.deadline = deadline;
        for (uint i = 0; i < choices.length; i++) {
            a.choices.push(choices[i]);
            // 初始化每个选项的累计下注为 0
            a.choiceBetAmounts.push(0);
        }
        a.initialPool = msg.value;
        a.totalPool = msg.value;
        a.settled = false;

        emit ActivityCreated(newActivityId, msg.value, deadline);
        return newActivityId;
    }

    // ========== 下注与票据铸造 ==========

    /// @notice 玩家下注，支付 ETH 获得一张 ERC721 票据
    /// @param activityId 要下注的活动 id
    /// @param choiceIndex 选择的选项索引
    function buyTicket(
        uint256 activityId,
        uint256 choiceIndex
    ) external payable returns (uint256) {
        require(activityExists(activityId), "Activity does not exist");
        Activity storage a = activities[activityId];
        require(!a.settled, "Activity already settled");
        require(block.timestamp < a.deadline, "Activity has ended");
        require(choiceIndex < a.choices.length, "Invalid choice index");
        require(msg.value > 0, "Bet amount must be greater than 0");

        // mint a new ticket
        _tokenIds += 1;
        uint256 newTokenId = _tokenIds;
        _safeMint(msg.sender, newTokenId);

        // 保存票据信息并加入活动票据列表
        tickets[newTokenId] = Ticket({
            activityId: activityId,
            choiceIndex: choiceIndex,
            amount: msg.value
        });
        a.ticketIds.push(newTokenId);
        // 更新对应选项累计下注金额
        // (createActivity 已初始化 a.choiceBetAmounts 长度与 choices 一致)
        a.choiceBetAmounts[choiceIndex] += msg.value;
        a.totalPool += msg.value;

        emit BetPlaced(newTokenId, activityId, msg.value, msg.sender);
        return newTokenId;
    }

    // ========== 二級市場（持票人掛單 -> 其他人購買） ==========

    /// @notice 持票人将票据挂单出售。注意：需要先 approve 给本合约（approve(tokenId) 或 setApprovalForAll）
    /// @param tokenId 要挂单的票据 id
    /// @param price 挂单价格（wei）
    function listTicket(uint256 tokenId, uint256 price) external {
        require(ownerOf(tokenId) == msg.sender, "Not the ticket owner");

        // 检查票据对应的活动是否已结算
        uint256 activityId = tickets[tokenId].activityId;
        require(
            !activities[activityId].settled,
            "Activity already settled, cannot list ticket"
        );

        require(price > 0, "Price must be greater than 0");
        // 合约需要被批准可以转移该 token
        require(
            _isApprovedOrOwnerForListing(tokenId, msg.sender),
            "Please approve contract to transfer ticket"
        );

        listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            exists: true
        });
        emit TicketListed(tokenId, msg.sender, price);
    }

    /// @notice 持票人取消挂单
    function cancelListing(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.exists, "No listing");
        require(l.seller == msg.sender, "Only seller can cancel");
        delete listings[tokenId];
        emit TicketListingCanceled(tokenId, msg.sender);
    }

    /// @notice 購買掛單票據（支付 exact price），合約會將款項轉給賣家並將票據轉移給買家
    function buyListedTicket(uint256 tokenId) external payable nonReentrant {
        Listing storage l = listings[tokenId];
        require(l.exists, "No listing");
        require(msg.value == l.price, "Payment must equal listing price");

        address seller = l.seller;
        address buyer = msg.sender;
        uint256 price = l.price;

        // 删除挂单（避免重入期间重复使用）
        delete listings[tokenId];

        // 执行票据转移：合约已被卖家批准，所以可以从卖家转出到买家
        _safeTransfer(seller, buyer, tokenId, "");

        // 将款项转给卖家（若失败则 revert）
        (bool sent, ) = payable(seller).call{value: price}("");
        require(sent, "Transfer to seller failed");

        emit TicketSold(tokenId, seller, buyer, price);
    }

    // ========== 结算 ==========

    /// @notice 合约 owner（公证人）结算活动，输入胜出选项索引。结算时按当前持有胜出票据的持有人均分 totalPool。
    /// @dev 遍历活动票据数组，gas 随票据数增长，请谨慎使用
    function settleActivity(
        uint256 activityId,
        uint256 winningChoice
    ) external onlyOwner nonReentrant {
        require(activityExists(activityId), "Activity does not exist");
        Activity storage a = activities[activityId];
        require(!a.settled, "Activity already settled");
        require(winningChoice < a.choices.length, "Invalid winning choice");

        a.settled = true;
        a.winningChoice = winningChoice;

        // 计算胜出选项的总下注金额（仅统计当前持有者）
        uint256 winnersCount = 0;
        uint256 totalWinningAmount = 0;
        for (uint i = 0; i < a.ticketIds.length; i++) {
            uint256 tid = a.ticketIds[i];
            if (tickets[tid].choiceIndex == winningChoice) {
                address holder = ownerOf(tid);
                if (holder != address(0)) {
                    winnersCount++;
                    totalWinningAmount += tickets[tid].amount;
                }
            }
        }

        if (winnersCount == 0 || totalWinningAmount == 0) {
            // 若无人胜出或胜出选项的总下注为 0，资金仍保留在合约中
            emit ActivitySettled(activityId, winningChoice, 0, a.totalPool);
            return;
        }

        // 按照每张票的下注占胜出选项总下注的比例分配奖池
        for (uint i = 0; i < a.ticketIds.length; i++) {
            uint256 tid = a.ticketIds[i];
            if (tickets[tid].choiceIndex == winningChoice) {
                address payable holder = payable(ownerOf(tid));
                if (holder == address(0)) continue;
                uint256 betAmount = tickets[tid].amount;
                // share = totalPool * betAmount / totalWinningAmount
                uint256 share = (a.totalPool * betAmount) / totalWinningAmount;
                (bool ok, ) = holder.call{value: share}("");
                require(ok, "Failed to send prize to winner");
            }
        }

        emit ActivitySettled(
            activityId,
            winningChoice,
            winnersCount,
            a.totalPool
        );
    }

    // ========== 新增的只读接口 ==========

    /// @notice 返回某地址拥有的所有 ticket ids（按当前持有人）
    function getTicketsByOwner(
        address owner
    ) external view returns (uint256[] memory) {
        return _ownerTickets[owner];
    }

    /// @notice 获取用户票据的详细信息
    function getTicketsWithDetails(
        address owner
    )
        external
        view
        returns (
            uint256[] memory tokenIds,
            uint256[] memory activityIds,
            uint256[] memory choiceIndices,
            uint256[] memory amounts,
            bool[] memory isListed,
            uint256[] memory listingPrices
        )
    {
        uint256[] memory ownedTokenIds = _ownerTickets[owner];
        uint256 count = ownedTokenIds.length;

        tokenIds = new uint256[](count);
        activityIds = new uint256[](count);
        choiceIndices = new uint256[](count);
        amounts = new uint256[](count);
        isListed = new bool[](count);
        listingPrices = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = ownedTokenIds[i];
            Ticket storage ticket = tickets[tokenId];

            tokenIds[i] = tokenId;
            activityIds[i] = ticket.activityId;
            choiceIndices[i] = ticket.choiceIndex;
            amounts[i] = ticket.amount;

            // 检查是否已挂单
            Listing storage listing = listings[tokenId];
            isListed[i] = listing.exists;
            listingPrices[i] = listing.exists ? listing.price : 0;
        }
    }

    /// @notice 判断 activityId 是否存在（用于前端与内部校验）
    function activityExists(uint256 activityId) public view returns (bool) {
        return activityId > 0 && activityId <= _activityIds;
    }

    /// @notice 返回某地址创建的所有 activity ids（用于前端自动查询"我创建的活动"）
    function getActivitiesByCreator(
        address creator
    ) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= _activityIds; i++) {
            if (activities[i].creator == creator) {
                count++;
            }
        }
        uint256[] memory res = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i <= _activityIds; i++) {
            if (activities[i].creator == creator) {
                res[idx++] = i;
            }
        }
        return res;
    }

    /// @notice 返回所有已创建的 activity ids（1 开始）
    function getAllActivityIds() external view returns (uint256[] memory ids) {
        ids = new uint256[](_activityIds);
        for (uint256 i = 0; i < _activityIds; i++) {
            ids[i] = i + 1;
        }
    }

    /// @notice 返回当前合约上所有存在的挂单（tokenId / seller / price），便于前端显示市场
    function getAllListings()
        external
        view
        returns (
            uint256[] memory tokenIds,
            address[] memory sellers,
            uint256[] memory prices
        )
    {
        uint256 cnt = 0;
        for (uint256 i = 1; i <= _tokenIds; i++) {
            if (listings[i].exists) cnt++;
        }
        tokenIds = new uint256[](cnt);
        sellers = new address[](cnt);
        prices = new uint256[](cnt);
        uint256 j = 0;
        for (uint256 i = 1; i <= _tokenIds; i++) {
            if (listings[i].exists) {
                tokenIds[j] = i;
                sellers[j] = listings[i].seller;
                prices[j] = listings[i].price;
                j++;
            }
        }
    }

    /// @notice 返回活动的详细信息（不包含 creator 与 ticketIds），包括每个选项的累计下注金额
    function getActivityDetail(
        uint256 activityId
    )
        external
        view
        returns (
            address creator,
            uint256 deadline,
            string memory content,
            string[] memory choices,
            uint256 initialPool,
            uint256 totalPool,
            bool settled,
            uint256 winningChoice,
            uint256[] memory choiceBetAmounts
        )
    {
        require(activityExists(activityId), "Activity does not exist");
        Activity storage a = activities[activityId];
        creator = a.creator;
        deadline = a.deadline;
        content = a.content;
        initialPool = a.initialPool;
        totalPool = a.totalPool;
        settled = a.settled;
        winningChoice = a.winningChoice;

        // 复制 choices 到 memory
        uint256 cLen = a.choices.length;
        choices = new string[](cLen);
        for (uint256 i = 0; i < cLen; i++) {
            choices[i] = a.choices[i];
        }

        // 复制 choiceBetAmounts 到 memory
        uint256 mLen = a.choiceBetAmounts.length;
        choiceBetAmounts = new uint256[](mLen);
        for (uint256 j = 0; j < mLen; j++) {
            choiceBetAmounts[j] = a.choiceBetAmounts[j];
        }
    }

    // ========== 内部与辅助函数 ==========

    /// @notice 检查卖家是否已经给合约批准用于转移 tokenId（要么单个 approve，要么 setApprovalForAll）
    function _isApprovedOrOwnerForListing(
        uint256 tokenId,
        address seller
    ) internal view returns (bool) {
        address approved = getApproved(tokenId);
        if (approved == address(this)) return true;
        if (isApprovedForAll(seller, address(this))) return true;
        return false;
    }

    function _addTicketToOwner(address owner, uint256 tokenId) private {
        uint256 length = _ownerTickets[owner].length;
        _ownerTickets[owner].push(tokenId);
        _ownerTicketIndex[tokenId] = length + 1;
    }

    function _removeTicketFromOwner(address owner, uint256 tokenId) private {
        uint256 indexPlusOne = _ownerTicketIndex[tokenId];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _ownerTickets[owner].length - 1;
        uint256 lastTokenId = _ownerTickets[owner][lastIndex];

        if (index != lastIndex) {
            _ownerTickets[owner][index] = lastTokenId;
            _ownerTicketIndex[lastTokenId] = index + 1;
        }

        _ownerTickets[owner].pop();
        delete _ownerTicketIndex[tokenId];
    }

    // ========== 紧急取款（仅 owner） ==========
    /// @notice 若合约内有遗留资金，合约 owner 可取回（谨慎使用）
    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Exceeds contract balance");
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        require(sent, "Withdraw failed");
    }

    // fallback / receive：合约可以接收 ETH（如结算后剩余的分配余数）
    receive() external payable {}

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = super._update(to, tokenId, auth);

        // 如果票据有挂单，自动取消（防止非市场交易后的无效挂单）
        if (listings[tokenId].exists) {
            delete listings[tokenId];
            if (from != address(0)) {
                emit TicketListingCanceled(tokenId, from);
            }
        }

        if (from != address(0)) {
            _removeTicketFromOwner(from, tokenId);
        }
        if (to != address(0)) {
            _addTicketToOwner(to, tokenId);
        }
        return from;
    }
}
